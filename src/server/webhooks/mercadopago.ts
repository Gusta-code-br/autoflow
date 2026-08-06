import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { comAdmin, type Transacao } from "../db";
import { consultarPagamentoMercadoPago, type PixCriado } from "../pagamentos/mercadopago";
import { ErroConfigWebhook } from "./assinatura";

/**
 * Verificação da notificação do Mercado Pago.
 *
 * Diferente da Meta, o segredo aqui não é o mesmo usado para criar a
 * cobrança (`MERCADOPAGO_ACCESS_TOKEN`): é uma chave à parte, gerada em
 * "Suas integrações > Webhooks > Configurar notificação" no painel do MP —
 * por isso `MERCADOPAGO_WEBHOOK_SECRET` é outra variável.
 *
 * O manifesto que o MP assina NÃO é o corpo — é esta string fixa:
 *
 *   id:{data.id};request-id:{x-request-id};ts:{ts};
 *
 * com `data.id` vindo da query string (não do body) e `ts`/`v1` extraídos do
 * cabeçalho `x-signature` (formato `ts=...,v1=...`). Ver documentação oficial:
 * https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/webhooks/webhooks
 */
export function assinaturaValidaMercadoPago(
  cabecalhoAssinatura: string | null | undefined,
  requestId: string | null | undefined,
  dataId: string | null | undefined,
): boolean {
  const segredo = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!segredo) throw new ErroConfigWebhook("MERCADOPAGO_WEBHOOK_SECRET não configurado");
  if (!cabecalhoAssinatura || !requestId || !dataId) return false;

  const partes = new Map<string, string>();
  for (const par of cabecalhoAssinatura.split(",")) {
    const [chave, valor] = par.split("=").map((s) => s.trim());
    if (chave && valor) partes.set(chave, valor);
  }
  const ts = partes.get("ts");
  const v1 = partes.get("v1");
  if (!ts || !v1) return false;

  // O MP manda o data.id como veio na URL; casos vistos em produção usam
  // minúsculo — normalizamos para não falhar por causa de caixa.
  const manifesto = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const esperada = createHmac("sha256", segredo).update(manifesto, "utf8").digest("hex");

  const recebida = Buffer.from(v1, "hex");
  const calculada = Buffer.from(esperada, "hex");
  if (recebida.length !== calculada.length) return false;
  return timingSafeEqual(recebida, calculada);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PagamentoRow {
  id: string;
  org_id: string;
  tipo: string;
  status: string;
  pacote_id: string | null;
  plano_id: string | null;
  periodicidade: "mensal" | "semestral" | "anual" | null;
  assinatura_id: string | null;
}

export interface ResumoProcessamento {
  pagamentoId: string | null;
  statusMp: string;
  transicao: "aprovado" | "recusado" | "estornado" | "sem_mudanca" | "nao_encontrado";
}

/**
 * Ponto de entrada chamado pela rota (e pelo cron de recuperação) com o
 * `data.id` do pagamento.
 *
 * Nunca confia nos valores que vieram na notificação — ela é só um "algo
 * mudou, vem ver"; o estado de verdade é o que a API do MP responder agora.
 * Isso também blinda contra notificação forjada com assinatura de outro
 * pagamento válido: mesmo que passasse pela verificação, o que aplicamos é
 * sempre o que a API (autenticada com NOSSO access token) devolve para esse id.
 */
export async function processarWebhookMercadoPago(
  mpPaymentId: string,
): Promise<ResumoProcessamento> {
  const info = await consultarPagamentoMercadoPago(mpPaymentId);
  const { pagamentoId, transicao } = await aplicarResultadoPagamento(info);
  return { pagamentoId, statusMp: info.status, transicao };
}

/**
 * Acha o pagamento pelo `mp_payment_id` (caso normal: o checkout já gravou
 * antes do webhook chegar) com fallback pelo `external_reference`, que é
 * sempre o nosso `pagamento.id` — cobre a corrida rara do webhook chegar
 * antes de terminarmos de salvar o id do MP na criação do PIX.
 */
async function localizarPagamento(tx: Transacao, info: PixCriado): Promise<PagamentoRow | null> {
  const refValida = Boolean(info.externalReference && UUID.test(info.externalReference));
  const [linha] = await tx<PagamentoRow[]>`
    SELECT id, org_id, tipo, status, pacote_id, plano_id, periodicidade, assinatura_id
      FROM pagamento
     WHERE mp_payment_id = ${info.mpPaymentId}
        OR (${refValida} AND id = ${refValida ? info.externalReference : null}::uuid)
     LIMIT 1
  `;
  return linha ?? null;
}

async function aplicarResultadoPagamento(
  info: PixCriado,
): Promise<{ pagamentoId: string | null; transicao: ResumoProcessamento["transicao"] }> {
  return comAdmin(async (tx) => {
    const pagamento = await localizarPagamento(tx, info);
    if (!pagamento) {
      // Não é necessariamente um bug nosso: pode ser notificação de um
      // pagamento de teste feito direto no painel do MP, sem passar pelo
      // checkout. 200 mesmo assim — reentregar não vai criar o pagamento.
      console.warn(
        `[webhook:mercadopago] pagamento não encontrado (mp_payment_id=${info.mpPaymentId}, external_reference=${info.externalReference ?? "—"})`,
      );
      return { pagamentoId: null, transicao: "nao_encontrado" as const };
    }

    // Rastreio sempre atualizado, tenha ou não mudado de estado — é o que a
    // tela de checkout mostra enquanto o cliente ainda está com o QR aberto.
    await tx`
      UPDATE pagamento
         SET mp_payment_id = ${info.mpPaymentId},
             mp_status_detail = ${info.statusDetail},
             pix_copia_cola = COALESCE(${info.pixCopiaCola}, pix_copia_cola),
             pix_qr_base64 = COALESCE(${info.qrBase64}, pix_qr_base64),
             ticket_url = COALESCE(${info.ticketUrl}, ticket_url),
             atualizado_em = now()
       WHERE id = ${pagamento.id}
    `;

    if (info.status === "approved") {
      const aplicado = await aprovarPagamento(tx, pagamento);
      return { pagamentoId: pagamento.id, transicao: aplicado ? "aprovado" : "sem_mudanca" };
    }

    if (info.status === "rejected" || info.status === "cancelled") {
      const [r] = await tx<{ id: string }[]>`
        UPDATE pagamento SET status = 'recusado', atualizado_em = now()
         WHERE id = ${pagamento.id} AND status = 'pendente'
        RETURNING id
      `;
      return { pagamentoId: pagamento.id, transicao: r ? "recusado" : "sem_mudanca" };
    }

    if (info.status === "refunded" || info.status === "charged_back") {
      // Estorno de algo já concedido (créditos gastos, assinatura em uso) é
      // decisão de suporte, não automação de webhook — por isso só marcamos
      // o pagamento e deixamos um rastro para revisão manual, sem reverter
      // o que já foi liberado para a organização.
      const [r] = await tx<{ id: string }[]>`
        UPDATE pagamento SET status = 'estornado', estornado_em = now(), atualizado_em = now()
         WHERE id = ${pagamento.id} AND status = 'aprovado'
        RETURNING id
      `;
      if (r) {
        console.warn(
          `[webhook:mercadopago] pagamento ${pagamento.id} estornado — revisar créditos/assinatura manualmente`,
        );
      }
      return { pagamentoId: pagamento.id, transicao: r ? "estornado" : "sem_mudanca" };
    }

    // pending / in_process / authorized / in_mediation / demais estados
    // transitórios do MP: nada além do rastreio já salvo acima.
    return { pagamentoId: pagamento.id, transicao: "sem_mudanca" };
  });
}

/** `true` só quando a transição pendente → aprovado aconteceu agora mesmo. */
async function aprovarPagamento(tx: Transacao, pagamento: PagamentoRow): Promise<boolean> {
  const [r] = await tx<{ id: string }[]>`
    UPDATE pagamento SET status = 'aprovado', pago_em = now(), atualizado_em = now()
     WHERE id = ${pagamento.id} AND status = 'pendente'
    RETURNING id
  `;
  if (!r) return false;

  if (pagamento.tipo === "creditos") {
    await creditarPacote(tx, pagamento);
  } else if (pagamento.tipo === "assinatura") {
    await ativarAssinatura(tx, pagamento);
  } else {
    // 'conexao' e 'cobranca_cliente' ainda não têm produto por trás (item 6
    // e a cobrança direta ao cliente final não passam por este checkout
    // ainda): fica pago no registro, sem efeito colateral automático.
    console.warn(
      `[webhook:mercadopago] pagamento ${pagamento.id} do tipo '${pagamento.tipo}' aprovado sem efeito automático`,
    );
  }
  return true;
}

async function creditarPacote(tx: Transacao, pagamento: PagamentoRow): Promise<void> {
  if (!pagamento.pacote_id) return;
  const [pacote] = await tx<{ creditos: number }[]>`
    SELECT creditos FROM pacote_credito WHERE id = ${pagamento.pacote_id}
  `;
  if (!pacote) return;

  await tx`
    INSERT INTO movimento_credito (org_id, tipo, quantidade, origem_tipo, origem_id, idempotencia)
    VALUES (${pagamento.org_id}, 'compra', ${pacote.creditos}, 'pagamento', ${pagamento.id},
            ${`pagamento:${pagamento.id}`})
  `;
}

async function ativarAssinatura(tx: Transacao, pagamento: PagamentoRow): Promise<void> {
  if (!pagamento.plano_id || !pagamento.periodicidade) {
    console.warn(`[webhook:mercadopago] pagamento ${pagamento.id} de assinatura sem plano/periodicidade`);
    return;
  }

  const [preco] = await tx<{ meses: number; creditos_mes: number; preco_total: string }[]>`
    SELECT pp.meses, p.creditos_mes, pp.preco_total
      FROM plano_preco pp
      JOIN plano p ON p.id = pp.plano_id
     WHERE pp.plano_id = ${pagamento.plano_id}
       AND pp.periodicidade = ${pagamento.periodicidade}::periodicidade
  `;
  if (!preco) {
    console.warn(
      `[webhook:mercadopago] plano ${pagamento.plano_id}/${pagamento.periodicidade} não encontrado no catálogo`,
    );
    return;
  }

  const expiraEm = await ativarOuRenovarAssinatura(tx, pagamento, preco);

  await tx`
    INSERT INTO movimento_credito (org_id, tipo, quantidade, origem_tipo, origem_id, idempotencia, expira_em)
    VALUES (${pagamento.org_id}, 'bonus_plano', ${preco.creditos_mes}, 'assinatura', ${pagamento.id},
            ${`pagamento:${pagamento.id}`}, ${expiraEm})
  `;
}

/**
 * Atualiza a assinatura vigente ligada ao pagamento (upgrade ou renovação —
 * ambos ativam na hora, ver `contratarPlano`) ou cria uma nova se a
 * organização não tinha nenhuma vigente no momento do checkout.
 *
 * Renovar antes de vencer soma ao que sobrava em vez de descartar: `GREATEST`
 * evita que o cliente perca dias já pagos, e evita também dar de graça o gap
 * para quem renova depois de já ter vencido.
 */
async function ativarOuRenovarAssinatura(
  tx: Transacao,
  pagamento: PagamentoRow,
  preco: { meses: number; preco_total: string },
): Promise<Date> {
  if (pagamento.assinatura_id) {
    const [assinatura] = await tx<{ expira_em: Date }[]>`
      UPDATE assinatura
         SET plano_id = ${pagamento.plano_id},
             periodicidade = ${pagamento.periodicidade}::periodicidade,
             status = 'ativa',
             preco_contratado = ${preco.preco_total},
             expira_em = GREATEST(expira_em, now()) + make_interval(months => ${preco.meses}),
             cancelada_em = NULL,
             motivo_cancelamento = NULL,
             atualizado_em = now()
       WHERE id = ${pagamento.assinatura_id}
      RETURNING expira_em
    `;
    if (assinatura) return assinatura.expira_em;
    // A assinatura referenciada sumiu entre o checkout e a confirmação
    // (caso raríssimo) — cai para criar uma nova abaixo.
  }

  const [nova] = await tx<{ expira_em: Date }[]>`
    INSERT INTO assinatura (org_id, plano_id, periodicidade, status, preco_contratado, expira_em)
    VALUES (${pagamento.org_id}, ${pagamento.plano_id}, ${pagamento.periodicidade}::periodicidade,
            'ativa', ${preco.preco_total}, now() + make_interval(months => ${preco.meses}))
    RETURNING expira_em
  `;
  return nova.expira_em;
}

export { ErroConfigWebhook } from "./assinatura";
