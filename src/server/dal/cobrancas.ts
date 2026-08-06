import "server-only";

import { z } from "zod";

import { type Transacao, centavos, comOrg } from "../db";
import { exigirContexto, exigirPapel } from "./contexto";
import { normalizarE164 } from "../dominio/telefone";
import { materializarDisparos } from "../dominio/regua";
import type { EtapaRegua, Referencia, Condicao, AcaoEtapa } from "../dominio/regua";

/**
 * Camada de acesso a cobranças. Duas responsabilidades que não podem sair
 * daqui: verificar quem está pedindo, e devolver DTO — nunca a linha crua.
 *
 * O que fica de fora do DTO importa tanto quanto o que entra: `contato.email`,
 * `documento` e `observacao` interna não vão para o cliente sem necessidade.
 */

export interface CobrancaDTO {
  id: string;
  descricao: string;
  valor: number;
  valorFormatadoCentavos: number;
  vencimento: string;
  status: "pendente" | "pago" | "vencido" | "negociando" | "cancelado";
  contato: {
    id: string;
    nome: string;
    /** Mascarado para atendente; completo para admin/dono. */
    telefone: string;
    optOut: boolean;
  };
  reguaId: string | null;
  reguaNome: string | null;
  tentativas: number;
  ultimoEnvioEm: string | null;
  pagoEm: string | null;
  criadoEm: string;
  proximoDisparoEm: string | null;
}

function mascararTelefone(e164: string): string {
  return e164.length > 6
    ? `${e164.slice(0, 5)}•••••${e164.slice(-2)}`
    : "•••••";
}

interface LinhaCobranca {
  id: string;
  descricao: string;
  valor: string;
  vencimento: Date;
  status: CobrancaDTO["status"];
  tentativas: number;
  ultimo_envio_em: Date | null;
  pago_em: Date | null;
  criado_em: Date;
  contato_id: string;
  contato_nome: string;
  telefone_e164: string;
  opt_out_em: Date | null;
  regua_id: string | null;
  regua_nome: string | null;
  proximo_disparo_em: Date | null;
}

function paraDTO(l: LinhaCobranca, podeVerTelefone: boolean): CobrancaDTO {
  return {
    id: l.id,
    descricao: l.descricao,
    valor: centavos(l.valor),
    valorFormatadoCentavos: centavos(l.valor),
    vencimento:
      l.vencimento instanceof Date
        ? l.vencimento.toISOString().slice(0, 10)
        : String(l.vencimento),
    status: l.status,
    contato: {
      id: l.contato_id,
      nome: l.contato_nome,
      telefone: podeVerTelefone
        ? l.telefone_e164
        : mascararTelefone(l.telefone_e164),
      optOut: l.opt_out_em !== null,
    },
    reguaId: l.regua_id,
    reguaNome: l.regua_nome,
    tentativas: l.tentativas,
    ultimoEnvioEm: l.ultimo_envio_em?.toISOString() ?? null,
    pagoEm: l.pago_em?.toISOString() ?? null,
    criadoEm: l.criado_em.toISOString(),
    proximoDisparoEm: l.proximo_disparo_em?.toISOString() ?? null,
  };
}

export interface FiltroCobrancas {
  status?: CobrancaDTO["status"][];
  busca?: string;
  limite?: number;
  cursor?: string;
}

export interface ResumoCobrancas {
  /** Centavos ainda na rua: pendente + vencido + negociando. */
  emAbertoCentavos: number;
  emAbertoQtd: number;
  vencidasQtd: number;
  vencidasCentavos: number;
  /** Centavos pagos no mês corrente, no fuso da organização. */
  recebidoMesCentavos: number;
  /** Parte do recebido que só veio depois de a régua ter mandado mensagem. */
  recuperadoMesCentavos: number;
  /** Mensagens de cobrança já agendadas e ainda não enviadas. */
  disparosAgendados: number;
  proximoDisparoEm: string | null;
}

/**
 * Os números do topo da tela de cobrança.
 *
 * Vale a query separada em vez de somar a lista em memória: a lista é
 * paginada, e um total que só considera as 50 primeiras é pior que não ter
 * total nenhum — o cliente confere com o extrato dele e perde a confiança na
 * tela inteira.
 */
export async function resumoCobrancas(): Promise<ResumoCobrancas> {
  const ctx = await exigirContexto();

  return comOrg(ctx.orgId, async (tx) => {
    const [l] = await tx<
      {
        em_aberto: string;
        em_aberto_qtd: string;
        vencidas_qtd: string;
        vencidas: string;
        recebido_mes: string;
        recuperado_mes: string;
        disparos_agendados: string;
        proximo_disparo_em: Date | null;
      }[]
    >`
      WITH ciclo AS (
        SELECT date_trunc('month', now() AT TIME ZONE o.fuso) AT TIME ZONE o.fuso AS inicio
          FROM organizacao o WHERE o.id = ${ctx.orgId}
      ),
      abertas AS (
        SELECT c.valor, c.status FROM cobranca c
         WHERE c.status IN ('pendente','negociando','vencido')
      )
      SELECT COALESCE((SELECT sum(valor) FROM abertas), 0)              AS em_aberto,
             COALESCE((SELECT count(*) FROM abertas), 0)                AS em_aberto_qtd,
             COALESCE((SELECT count(*) FROM abertas
                        WHERE status = 'vencido'), 0)                   AS vencidas_qtd,
             COALESCE((SELECT sum(valor) FROM abertas
                        WHERE status = 'vencido'), 0)                   AS vencidas,
             COALESCE((SELECT sum(c.valor_pago) FROM cobranca c
                        WHERE c.status = 'pago'
                          AND c.pago_em >= (SELECT inicio FROM ciclo)), 0)
                                                                        AS recebido_mes,
             /*
              * "Recuperado" exige envio antes do pagamento: sem isso a régua
              * levaria crédito por quem pagaria de qualquer jeito, e o número
              * que justifica a assinatura viraria ficção.
              */
             COALESCE((SELECT sum(c.valor_pago) FROM cobranca c
                        WHERE c.status = 'pago'
                          AND c.pago_em >= (SELECT inicio FROM ciclo)
                          AND EXISTS (
                            SELECT 1 FROM disparo d
                             WHERE d.cobranca_id = c.id
                               AND d.status = 'enviado'
                               AND d.processado_em < c.pago_em
                          )), 0)                                        AS recuperado_mes,
             COALESCE((SELECT count(*) FROM disparo d
                        WHERE d.status = 'agendado'), 0)                AS disparos_agendados,
             (SELECT min(d.executar_em) FROM disparo d
               WHERE d.status = 'agendado')                             AS proximo_disparo_em
    `;

    return {
      emAbertoCentavos: centavos(l.em_aberto),
      emAbertoQtd: Number(l.em_aberto_qtd),
      vencidasQtd: Number(l.vencidas_qtd),
      vencidasCentavos: centavos(l.vencidas),
      recebidoMesCentavos: centavos(l.recebido_mes),
      recuperadoMesCentavos: centavos(l.recuperado_mes),
      disparosAgendados: Number(l.disparos_agendados),
      proximoDisparoEm: l.proximo_disparo_em?.toISOString() ?? null,
    };
  });
}

export async function listarCobrancas(
  filtro: FiltroCobrancas = {},
): Promise<CobrancaDTO[]> {
  const ctx = await exigirContexto();
  const limite = Math.min(filtro.limite ?? 50, 200);
  const busca = filtro.busca?.trim() ?? "";

  return comOrg(ctx.orgId, async (tx) => {
    const linhas = await tx<LinhaCobranca[]>`
      SELECT c.id, c.descricao, c.valor, c.vencimento, c.status, c.tentativas,
             c.ultimo_envio_em, c.pago_em, c.criado_em,
             ct.id AS contato_id, ct.nome AS contato_nome,
             ct.telefone_e164, ct.opt_out_em,
             r.id AS regua_id, r.nome AS regua_nome,
             (SELECT min(d.executar_em)
                FROM disparo d
               WHERE d.cobranca_id = c.id
                 AND d.status = 'agendado') AS proximo_disparo_em
        FROM cobranca c
        JOIN contato ct ON ct.id = c.contato_id
        LEFT JOIN regua r ON r.id = c.regua_id
       WHERE ${
         filtro.status?.length
           ? tx`c.status = ANY(${filtro.status}::status_cobranca[])`
           : tx`true`
       }
         AND ${
           busca
             ? tx`(ct.nome ILIKE ${"%" + busca + "%"} OR c.descricao ILIKE ${"%" + busca + "%"} OR ct.telefone_e164 ILIKE ${"%" + busca.replace(/\D/g, "") + "%"})`
             : tx`true`
         }
         AND ${filtro.cursor ? tx`c.criado_em < ${filtro.cursor}` : tx`true`}
       ORDER BY c.criado_em DESC
       LIMIT ${limite}
    `;

    const podeVerTelefone = ctx.papel !== "atendente";
    return linhas.map((l) => paraDTO(l, podeVerTelefone));
  });
}

export async function buscarCobranca(id: string): Promise<CobrancaDTO | null> {
  const ctx = await exigirContexto();

  return comOrg(ctx.orgId, async (tx) => {
    const linhas = await tx<LinhaCobranca[]>`
      SELECT c.id, c.descricao, c.valor, c.vencimento, c.status, c.tentativas,
             c.ultimo_envio_em, c.pago_em, c.criado_em,
             ct.id AS contato_id, ct.nome AS contato_nome,
             ct.telefone_e164, ct.opt_out_em,
             r.id AS regua_id, r.nome AS regua_nome,
             (SELECT min(d.executar_em)
                FROM disparo d
               WHERE d.cobranca_id = c.id AND d.status = 'agendado')
               AS proximo_disparo_em
        FROM cobranca c
        JOIN contato ct ON ct.id = c.contato_id
        LEFT JOIN regua r ON r.id = c.regua_id
       WHERE c.id = ${id}
       LIMIT 1
    `;
    const l = linhas[0];
    return l ? paraDTO(l, ctx.papel !== "atendente") : null;
  });
}

export const EntradaNovaCobranca = z.object({
  contato: z.object({
    nome: z.string().trim().min(2, "informe o nome").max(120),
    telefone: z.string().trim().min(8, "informe o telefone"),
    email: z.string().trim().email().optional().or(z.literal("")),
  }),
  descricao: z.string().trim().min(2, "descreva a cobrança").max(200),
  valorCentavos: z.number().int().positive("valor deve ser maior que zero"),
  vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data inválida"),
  reguaId: z.string().uuid().nullable().optional(),
  observacao: z.string().trim().max(1000).optional(),
  externoId: z.string().trim().max(100).optional(),
});

export type EntradaNovaCobranca = z.infer<typeof EntradaNovaCobranca>;

export interface ResultadoCriacao {
  cobrancaId: string;
  disparosAgendados: number;
  primeiroDisparoEm: string | null;
  avisos: string[];
}

/**
 * Cria a cobrança e já materializa os disparos da régua, tudo na mesma
 * transação: se o agendamento falhar, a cobrança não fica órfã esperando um
 * worker que nunca vai encontrá-la.
 */
export async function criarCobranca(
  entrada: EntradaNovaCobranca,
): Promise<ResultadoCriacao> {
  const ctx = await exigirPapel("atendente", "criar cobrança");
  const dados = EntradaNovaCobranca.parse(entrada);

  const e164 = normalizarE164(dados.contato.telefone);
  if (!e164) throw new Error("telefone inválido — confira o DDD e o número");

  const avisos: string[] = [];

  return comOrg(ctx.orgId, async (tx) => {
    // Contato é único por (org, telefone): reaproveita em vez de duplicar.
    const [contato] = await tx<{ id: string; opt_out_em: Date | null }[]>`
      INSERT INTO contato (org_id, nome, telefone_e164, email)
      VALUES (${ctx.orgId}, ${dados.contato.nome}, ${e164},
              ${dados.contato.email || null})
      ON CONFLICT (org_id, telefone_e164) DO UPDATE
        SET nome = EXCLUDED.nome,
            atualizado_em = now()
      RETURNING id, opt_out_em
    `;

    if (contato.opt_out_em) {
      avisos.push(
        "Este contato pediu para não receber mensagens. A cobrança foi criada, mas nenhum envio automático será feito.",
      );
    }

    const [cobranca] = await tx<{ id: string }[]>`
      INSERT INTO cobranca (org_id, contato_id, descricao, valor, vencimento,
                            regua_id, observacao, externo_id, criado_por, origem)
      VALUES (${ctx.orgId}, ${contato.id}, ${dados.descricao},
              ${dados.valorCentavos}, ${dados.vencimento},
              ${dados.reguaId ?? null}, ${dados.observacao ?? null},
              ${dados.externoId ?? null}, ${ctx.usuarioId}, 'manual')
      RETURNING id
    `;

    await tx`
      INSERT INTO cobranca_evento (org_id, cobranca_id, tipo, descricao, usuario_id)
      VALUES (${ctx.orgId}, ${cobranca.id}, 'criada',
              ${`Cobrança criada por ${ctx.nome}`}, ${ctx.usuarioId})
    `;

    const agendados = dados.reguaId
      ? await agendarRegua(tx, {
          orgId: ctx.orgId,
          cobrancaId: cobranca.id,
          reguaId: dados.reguaId,
          vencimento: dados.vencimento,
          bloqueado: contato.opt_out_em !== null,
          avisos,
        })
      : { total: 0, primeiro: null as Date | null };

    return {
      cobrancaId: cobranca.id,
      disparosAgendados: agendados.total,
      primeiroDisparoEm: agendados.primeiro?.toISOString() ?? null,
      avisos,
    };
  });
}

interface ParametrosAgendamento {
  orgId: string;
  cobrancaId: string;
  reguaId: string;
  vencimento: string;
  bloqueado: boolean;
  avisos: string[];
}

/**
 * Traduz a régua configurada em linhas de `disparo`. A decisão de *quando* é do
 * domínio puro (testado); aqui só há I/O.
 */
async function agendarRegua(
  tx: Transacao,
  p: ParametrosAgendamento,
): Promise<{ total: number; primeiro: Date | null }> {
  if (p.bloqueado) return { total: 0, primeiro: null };

  const [org] = await tx<
    {
      fuso: string;
      horario_inicio: string;
      horario_fim: string;
      dias_semana: number[];
    }[]
  >`
    SELECT fuso, horario_inicio::text, horario_fim::text, dias_semana
      FROM organizacao WHERE id = ${p.orgId}
  `;

  const etapasBanco = await tx<
    {
      id: string;
      ordem: number;
      referencia: Referencia;
      offset_dias: number;
      hora: string;
      condicao: Condicao;
      acao: AcaoEtapa;
      ativa: boolean;
    }[]
  >`
    SELECT e.id, e.ordem, e.referencia, e.offset_dias, e.hora::text,
           e.condicao, e.acao, e.ativa
      FROM regua_etapa e
      JOIN regua r ON r.id = e.regua_id
     WHERE e.regua_id = ${p.reguaId} AND r.ativa
     ORDER BY e.ordem
  `;

  if (etapasBanco.length === 0) {
    p.avisos.push("A régua escolhida não tem etapas ativas.");
    return { total: 0, primeiro: null };
  }

  const etapas: EtapaRegua[] = etapasBanco.map((e) => ({
    id: e.id,
    ordem: e.ordem,
    referencia: e.referencia,
    offsetDias: e.offset_dias,
    hora: e.hora.slice(0, 5),
    condicao: e.condicao,
    acao: e.acao,
    ativa: e.ativa,
  }));

  const plano = materializarDisparos(
    etapas,
    { id: p.cobrancaId, vencimento: p.vencimento, criadaEm: new Date() },
    {
      fuso: org.fuso,
      horarioInicio: org.horario_inicio.slice(0, 5),
      horarioFim: org.horario_fim.slice(0, 5),
      diasSemana: org.dias_semana,
    },
  );

  const perdidas = plano.descartadas.filter(
    (d) => d.motivo === "janela_perdida",
  ).length;
  if (perdidas > 0) {
    p.avisos.push(
      `${perdidas} ${perdidas === 1 ? "etapa foi ignorada por já ter passado" : "etapas foram ignoradas por já terem passado"} — a cobrança entrou com o vencimento no passado.`,
    );
  }

  if (plano.disparos.length === 0) return { total: 0, primeiro: null };

  const [execucao] = await tx<{ id: string }[]>`
    INSERT INTO regua_execucao (org_id, cobranca_id, regua_id)
    VALUES (${p.orgId}, ${p.cobrancaId}, ${p.reguaId})
    RETURNING id
  `;

  await tx`
    INSERT INTO disparo ${tx(
      plano.disparos.map((d) => ({
        org_id: p.orgId,
        execucao_id: execucao.id,
        etapa_id: d.etapaId,
        cobranca_id: p.cobrancaId,
        executar_em: d.executarEm,
      })),
    )}
    ON CONFLICT (execucao_id, etapa_id) DO NOTHING
  `;

  return { total: plano.disparos.length, primeiro: plano.disparos[0].executarEm };
}

/** Pagamento manual: encerra a régua para não cobrar quem já pagou. */
export async function marcarComoPago(
  cobrancaId: string,
  valorPagoCentavos?: number,
): Promise<void> {
  const ctx = await exigirPapel("atendente", "marcar pagamento");

  await comOrg(ctx.orgId, async (tx) => {
    const [cob] = await tx<{ id: string; valor: string }[]>`
      UPDATE cobranca
         SET status = 'pago',
             pago_em = now(),
             valor_pago = COALESCE(${valorPagoCentavos ?? null}, valor),
             atualizado_em = now()
       WHERE id = ${cobrancaId} AND status <> 'pago'
      RETURNING id, valor
    `;
    if (!cob) return;

    // Cancela o que ainda não saiu. O `disparo` de ação 'se_pago' é
    // remarcado pelo worker de pós-pagamento.
    await tx`
      UPDATE disparo
         SET status = 'cancelado', motivo_ignorado = 'cobranca_paga',
             processado_em = now()
       WHERE cobranca_id = ${cobrancaId} AND status = 'agendado'
    `;

    await tx`
      UPDATE regua_execucao
         SET status = 'concluida', motivo_parada = 'pago', encerrada_em = now()
       WHERE cobranca_id = ${cobrancaId} AND status = 'ativa'
    `;

    await tx`
      INSERT INTO cobranca_evento (org_id, cobranca_id, tipo, descricao, usuario_id)
      VALUES (${ctx.orgId}, ${cobrancaId}, 'pagou',
              ${`Baixa manual por ${ctx.nome}`}, ${ctx.usuarioId})
    `;
  });
}

/**
 * Cancela a cobrança e cala a régua.
 *
 * Cancelar não é apagar: a cobrança some das listas de trabalho mas o
 * histórico fica, porque o cliente do outro lado recebeu mensagens de verdade
 * e alguém vai perguntar por que. O que precisa parar imediatamente é o que
 * ainda não saiu — disparo agendado vira 'cancelado' na mesma transação, para
 * não existir a janela em que a cobrança está cancelada e o worker manda
 * cobrar assim mesmo.
 */
export async function cancelarCobranca(
  cobrancaId: string,
  motivo?: string,
): Promise<void> {
  const ctx = await exigirPapel("atendente", "cancelar cobrança");

  await comOrg(ctx.orgId, async (tx) => {
    const [cob] = await tx<{ id: string }[]>`
      UPDATE cobranca
         SET status = 'cancelado', atualizado_em = now()
       WHERE id = ${cobrancaId} AND status NOT IN ('pago', 'cancelado')
      RETURNING id
    `;
    if (!cob) return;

    await tx`
      UPDATE disparo
         SET status = 'cancelado', motivo_ignorado = 'cobranca_cancelada',
             processado_em = now()
       WHERE cobranca_id = ${cobrancaId} AND status = 'agendado'
    `;

    await tx`
      UPDATE regua_execucao
         SET status = 'concluida', motivo_parada = 'cancelada',
             encerrada_em = now()
       WHERE cobranca_id = ${cobrancaId} AND status = 'ativa'
    `;

    await tx`
      INSERT INTO cobranca_evento (org_id, cobranca_id, tipo, descricao, usuario_id)
      VALUES (${ctx.orgId}, ${cobrancaId}, 'cancelou',
              ${motivo?.trim() || `Cancelada por ${ctx.nome}`}, ${ctx.usuarioId})
    `;
  });
}
