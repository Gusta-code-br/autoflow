import "server-only";

import { comOrg, centavos, sql } from "../db";
import {
  exigirContexto,
  exigirPapel,
  podeVerFinanceiro,
  SemPermissaoError,
} from "./contexto";

/**
 * Plano, créditos de IA e faturas.
 *
 * Três decisões que moldam este arquivo:
 *
 * 1. **O catálogo vem do banco, não de `src/lib/plans.ts`.** Aquele arquivo
 *    continua existindo para a landing (estática, sem banco), mas o painel de
 *    um cliente pagante não pode mostrar preço de constante compilada: quem
 *    assinou por R$ 197 tem `preco_contratado` gravado na assinatura e vê esse
 *    valor mesmo depois de um reajuste na tabela.
 *
 * 2. **Saldo é derivado do ledger, nunca somado na UI.** `organizacao.
 *    saldo_creditos` é mantido por trigger sobre `movimento_credito`; aqui só
 *    lemos. O consumo por feature sai de `uso_ia`, que é a origem real do
 *    débito — assim a soma das barrinhas bate com o saldo.
 *
 * 3. **Atendente não vê dinheiro.** `podeVerFinanceiro` decide, e a checagem
 *    está aqui dentro (junto da query), não na página: Server Action e rota
 *    filha não passam pelo layout que "protegeria" a tela.
 */

export interface PlanoCatalogo {
  id: string;
  nome: string;
  chamada: string | null;
  precoMensal: number;
  features: string[];
  creditosMes: number;
  conexoesInclusas: number;
  beneficios: string[];
  destaque: boolean;
  /** Um preço por periodicidade, já com desconto aplicado. */
  precos: {
    periodicidade: "mensal" | "semestral" | "anual";
    meses: number;
    descontoBp: number;
    precoTotal: number;
    /** `precoTotal / meses`, para comparar maçã com maçã na tabela. */
    precoMensalEquivalente: number;
  }[];
}

export interface PacoteCatalogo {
  id: string;
  creditos: number;
  preco: number;
  selo: string | null;
}

export interface AssinaturaAtual {
  planoId: string | null;
  planoNome: string | null;
  periodicidade: "mensal" | "semestral" | "anual" | null;
  status: string | null;
  /** O que ele paga de fato, não o preço de tabela de hoje. */
  precoContratado: number;
  conexoesExtras: number;
  expiraEm: Date | null;
  renovacaoAutomatica: boolean;
  /** Negativo quando já venceu. */
  diasParaExpirar: number | null;
}

export interface ConsumoCreditos {
  totais: number;
  usados: number;
  restantes: number;
  /** 0–100, arredondado. */
  percentual: number;
  porFeature: { atendimento: number; cobranca: number; agendamento: number };
  /** Últimos 14 dias no fuso da organização, do mais antigo ao mais recente. */
  diario: {
    dia: string;
    atendimento: number;
    cobranca: number;
    agendamento: number;
  }[];
  /** Média por dia dos dias já corridos no ciclo. */
  mediaDiaria: number;
  /** Quantos dias o saldo ainda dura no ritmo atual; `null` se não consome. */
  diasRestantes: number | null;
}

export interface FaturaDTO {
  id: string;
  tipo: string;
  descricao: string;
  valor: number;
  metodo: string;
  status: string;
  criadoEm: Date;
  pagoEm: Date | null;
  /** Link do comprovante/boleto no Mercado Pago, quando houver. */
  ticketUrl: string | null;
}

export interface PainelCreditos {
  assinatura: AssinaturaAtual;
  consumo: ConsumoCreditos;
  faturas: FaturaDTO[];
  catalogo: PlanoCatalogo[];
  pacotes: PacoteCatalogo[];
  precoConexaoExtra: number;
}

// ---------------------------------------------------------------------------
// Catálogo — global, não pertence a nenhuma organização

interface LinhaPlano {
  id: string;
  nome: string;
  chamada: string | null;
  preco_mensal: string;
  features: string[];
  creditos_mes: number;
  conexoes_inclusas: number;
  beneficios: string[];
  destaque: boolean;
  precos: {
    periodicidade: "mensal" | "semestral" | "anual";
    meses: number;
    desconto_bp: number;
    preco_total: string;
  }[];
}

/**
 * Roda em `sql` cru, sem `comOrg`: `plano` e `pacote_credito` são tabelas de
 * catálogo, sem `org_id` e sem policy. Passar por `comOrg` só abriria uma
 * transação à toa.
 */
export async function catalogo(): Promise<{
  planos: PlanoCatalogo[];
  pacotes: PacoteCatalogo[];
  precoConexaoExtra: number;
}> {
  const [planos, pacotes, parametros] = await Promise.all([
    sql<LinhaPlano[]>`
      SELECT p.id, p.nome, p.chamada, p.preco_mensal, p.features,
             p.creditos_mes, p.conexoes_inclusas, p.beneficios, p.destaque,
             COALESCE((
               SELECT json_agg(json_build_object(
                        'periodicidade', pp.periodicidade,
                        'meses', pp.meses,
                        'desconto_bp', pp.desconto_bp,
                        'preco_total', pp.preco_total::text
                      ) ORDER BY pp.meses)
                 FROM plano_preco pp
                WHERE pp.plano_id = p.id AND pp.ativo
             ), '[]'::json) AS precos
        FROM plano p
       WHERE p.ativo
       ORDER BY p.ordem
    `,
    sql<{ id: string; creditos: number; preco: string; selo: string | null }[]>`
      SELECT id, creditos, preco, selo
        FROM pacote_credito
       WHERE ativo
       ORDER BY creditos
    `,
    sql<{ chave: string; valor: unknown }[]>`
      SELECT chave, valor FROM parametro WHERE chave = 'preco_conexao_extra'
    `,
  ]);

  return {
    planos: planos.map((p) => ({
      id: p.id,
      nome: p.nome,
      chamada: p.chamada,
      precoMensal: centavos(p.preco_mensal),
      features: p.features ?? [],
      creditosMes: p.creditos_mes,
      conexoesInclusas: p.conexoes_inclusas,
      beneficios: p.beneficios ?? [],
      destaque: p.destaque,
      precos: (p.precos ?? []).map((pr) => ({
        periodicidade: pr.periodicidade,
        meses: pr.meses,
        descontoBp: pr.desconto_bp,
        precoTotal: centavos(pr.preco_total),
        precoMensalEquivalente: Math.round(
          centavos(pr.preco_total) / Math.max(1, pr.meses),
        ),
      })),
    })),
    pacotes: pacotes.map((c) => ({
      id: c.id,
      creditos: c.creditos,
      preco: centavos(c.preco),
      selo: c.selo,
    })),
    precoConexaoExtra: Number(parametros[0]?.valor ?? 4900),
  };
}

// ---------------------------------------------------------------------------
// Leitura da organização

interface LinhaAssinatura {
  plano_id: string | null;
  plano_nome: string | null;
  periodicidade: "mensal" | "semestral" | "anual" | null;
  status: string | null;
  preco_contratado: string | null;
  conexoes_extras: number | null;
  expira_em: Date | null;
  renovacao_automatica: boolean | null;
  creditos_mes: number | null;
}

interface LinhaConsumo {
  finalidade: "atendimento" | "cobranca" | "agendamento";
  creditos: string;
}

interface LinhaDiario {
  dia: string;
  atendimento: string;
  cobranca: string;
  agendamento: string;
}

/**
 * Uma ida ao banco para a tela inteira de "Plano e créditos".
 *
 * As quatro leituras vão em paralelo *dentro da mesma transação* de propósito:
 * `comOrg` seta `app.org_id` como LOCAL, então só quem está nesta transação
 * enxerga a organização certa. Disparar `Promise.all` com queries de conexões
 * diferentes cairia em sessões sem o GUC e voltaria vazio.
 */
export async function painelCreditos(): Promise<PainelCreditos> {
  const ctx = await exigirContexto();
  if (!podeVerFinanceiro(ctx.papel)) {
    // Não é 403 de tela: é a DAL recusando devolver dinheiro para quem não
    // pode ver dinheiro. A página trata e mostra o aviso.
    throw new SemPermissaoError("ver plano e faturas");
  }

  const cat = await catalogo();

  return comOrg(ctx.orgId, async (tx) => {
    const [assinatura] = await tx<LinhaAssinatura[]>`
      SELECT a.plano_id, p.nome AS plano_nome, a.periodicidade, a.status,
             a.preco_contratado, a.conexoes_extras, a.expira_em,
             a.renovacao_automatica, p.creditos_mes
        FROM assinatura a
        LEFT JOIN plano p ON p.id = a.plano_id
       WHERE a.status IN ('trial','ativa','inadimplente')
       LIMIT 1
    `;

    const [saldo] = await tx<{ saldo: string; entradas: string }[]>`
      SELECT o.saldo_creditos::text AS saldo,
             /*
              * Entradas do ciclo: plano + pacotes comprados. É o denominador
              * honesto da barra — quem comprou um pacote de 5.000 não deve ver
              * "115% usado" só porque o plano dele dá 3.000 por mês.
              */
             COALESCE((
               SELECT sum(mc.quantidade)
                 FROM movimento_credito mc
                WHERE mc.quantidade > 0
                  AND mc.criado_em >= date_trunc('month', now() AT TIME ZONE o.fuso)
                        AT TIME ZONE o.fuso
             ), 0)::text AS entradas
        FROM organizacao o
       WHERE o.id = ${ctx.orgId}
    `;

    const consumoPorFeature = await tx<LinhaConsumo[]>`
      SELECT u.finalidade, COALESCE(sum(u.creditos), 0)::text AS creditos
        FROM uso_ia u
        JOIN organizacao o ON o.id = u.org_id
       WHERE u.criado_em >= date_trunc('month', now() AT TIME ZONE o.fuso)
             AT TIME ZONE o.fuso
       GROUP BY u.finalidade
    `;

    /*
     * `generate_series` garante os 14 dias mesmo nos dias sem uso: gráfico com
     * buraco mente sobre a tendência, e o LEFT JOIN custa nada nesse volume.
     */
    const diario = await tx<LinhaDiario[]>`
      WITH tz AS (SELECT fuso FROM organizacao WHERE id = ${ctx.orgId}),
      dias AS (
        SELECT to_char(d, 'YYYY-MM-DD') AS dia, d::date AS ref
          FROM tz, generate_series(
                 (now() AT TIME ZONE tz.fuso)::date - interval '13 days',
                 (now() AT TIME ZONE tz.fuso)::date,
                 interval '1 day'
               ) AS d
      )
      SELECT dias.dia,
             COALESCE(sum(u.creditos) FILTER (WHERE u.finalidade = 'atendimento'), 0)::text AS atendimento,
             COALESCE(sum(u.creditos) FILTER (WHERE u.finalidade = 'cobranca'), 0)::text AS cobranca,
             COALESCE(sum(u.creditos) FILTER (WHERE u.finalidade = 'agendamento'), 0)::text AS agendamento
        FROM dias
        CROSS JOIN tz
        LEFT JOIN uso_ia u
               ON (u.criado_em AT TIME ZONE tz.fuso)::date = dias.ref
       GROUP BY dias.dia
       ORDER BY dias.dia
    `;

    const faturas = await tx<
      {
        id: string;
        tipo: string;
        descricao: string;
        valor: string;
        metodo: string;
        status: string;
        criado_em: Date;
        pago_em: Date | null;
        ticket_url: string | null;
      }[]
    >`
      SELECT id, tipo, descricao, valor, metodo, status,
             criado_em, pago_em, ticket_url
        FROM pagamento
       WHERE tipo IN ('assinatura','creditos','conexao')
       ORDER BY criado_em DESC
       LIMIT 24
    `;

    const porFeature = { atendimento: 0, cobranca: 0, agendamento: 0 };
    for (const linha of consumoPorFeature) {
      porFeature[linha.finalidade] = Number(linha.creditos);
    }

    const restantes = Number(saldo?.saldo ?? 0);
    const usados = porFeature.atendimento + porFeature.cobranca + porFeature.agendamento;
    const entradas = Number(saldo?.entradas ?? 0);
    const totais = Math.max(entradas, usados + restantes, assinatura?.creditos_mes ?? 0);

    // Ritmo: só conta os dias com consumo registrado, senão instalação nova
    // dividiria por 14 e projetaria "dura 3 anos".
    const diasComUso = diario.filter(
      (d) => Number(d.atendimento) + Number(d.cobranca) + Number(d.agendamento) > 0,
    ).length;
    const usadoNaJanela = diario.reduce(
      (soma, d) =>
        soma + Number(d.atendimento) + Number(d.cobranca) + Number(d.agendamento),
      0,
    );
    const mediaDiaria = diasComUso > 0 ? Math.round(usadoNaJanela / diasComUso) : 0;

    const expiraEm = assinatura?.expira_em ?? null;

    return {
      assinatura: {
        planoId: assinatura?.plano_id ?? null,
        planoNome: assinatura?.plano_nome ?? null,
        periodicidade: assinatura?.periodicidade ?? null,
        status: assinatura?.status ?? null,
        precoContratado: assinatura?.preco_contratado
          ? centavos(assinatura.preco_contratado)
          : 0,
        conexoesExtras: assinatura?.conexoes_extras ?? 0,
        expiraEm,
        renovacaoAutomatica: assinatura?.renovacao_automatica ?? false,
        diasParaExpirar: expiraEm
          ? Math.ceil((expiraEm.getTime() - Date.now()) / 86_400_000)
          : null,
      },
      consumo: {
        totais,
        usados,
        restantes,
        percentual: totais > 0 ? Math.min(100, Math.round((usados / totais) * 100)) : 0,
        porFeature,
        diario: diario.map((d) => ({
          dia: d.dia,
          atendimento: Number(d.atendimento),
          cobranca: Number(d.cobranca),
          agendamento: Number(d.agendamento),
        })),
        mediaDiaria,
        diasRestantes: mediaDiaria > 0 ? Math.floor(restantes / mediaDiaria) : null,
      },
      faturas: faturas.map((f) => ({
        id: f.id,
        tipo: f.tipo,
        descricao: f.descricao,
        valor: centavos(f.valor),
        metodo: f.metodo,
        status: f.status,
        criadoEm: f.criado_em,
        pagoEm: f.pago_em,
        ticketUrl: f.ticket_url,
      })),
      catalogo: cat.planos,
      pacotes: cat.pacotes,
      precoConexaoExtra: cat.precoConexaoExtra,
    };
  });
}

export interface PagamentoCheckout {
  id: string;
  tipo: string;
  descricao: string;
  valor: number;
  metodo: string;
  status: string;
  /** `null` enquanto o provedor não devolveu o PIX (ou em modo simulado). */
  pixCopiaCola: string | null;
  qrBase64: string | null;
  ticketUrl: string | null;
  expiraEm: Date | null;
  pagoEm: Date | null;
  criadoEm: Date;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Um pagamento da própria organização, para a tela de checkout.
 *
 * O `id` vem da URL, então é entrada de usuário: sem o teste de formato, um
 * `/painel/checkout/qualquer-coisa` viraria erro de sintaxe de uuid no
 * Postgres (500) em vez do 404 que a tela sabe mostrar. A policy de `pagamento`
 * já limita ao `org_id` da sessão — o `WHERE id` não precisa repetir isso, mas
 * o resultado nulo cobre tanto "não existe" quanto "é de outro tenant".
 */
export async function buscarPagamento(
  id: string,
): Promise<PagamentoCheckout | null> {
  const ctx = await exigirContexto();
  if (!podeVerFinanceiro(ctx.papel)) {
    throw new SemPermissaoError("ver pagamentos");
  }
  if (!UUID.test(id)) return null;

  return comOrg(ctx.orgId, async (tx) => {
    const [p] = await tx<
      {
        id: string;
        tipo: string;
        descricao: string;
        valor: string;
        metodo: string;
        status: string;
        pix_copia_cola: string | null;
        pix_qr_base64: string | null;
        ticket_url: string | null;
        expira_em: Date | null;
        pago_em: Date | null;
        criado_em: Date;
      }[]
    >`
      SELECT id, tipo, descricao, valor, metodo, status,
             pix_copia_cola, pix_qr_base64, ticket_url,
             expira_em, pago_em, criado_em
        FROM pagamento
       WHERE id = ${id}
    `;
    if (!p) return null;

    return {
      id: p.id,
      tipo: p.tipo,
      descricao: p.descricao,
      valor: centavos(p.valor),
      metodo: p.metodo,
      status: p.status,
      pixCopiaCola: p.pix_copia_cola,
      qrBase64: p.pix_qr_base64,
      ticketUrl: p.ticket_url,
      expiraEm: p.expira_em,
      pagoEm: p.pago_em,
      criadoEm: p.criado_em,
    };
  });
}

// ---------------------------------------------------------------------------
// Escrita

export interface CobrancaPix {
  pagamentoId: string;
  valor: number;
  /** `null` quando o Mercado Pago ainda não está conectado (modo simulado). */
  pixCopiaCola: string | null;
  qrBase64: string | null;
  expiraEm: Date | null;
}

/**
 * Registra a intenção de compra de um pacote de créditos.
 *
 * Não credita nada: quem credita é o webhook de pagamento aprovado, com
 * `idempotencia` própria. Crédito liberado no clique é crédito de graça para
 * quem fecha o navegador antes de pagar.
 */
export async function comprarPacote(pacoteId: string): Promise<CobrancaPix> {
  const ctx = await exigirPapel("admin", "comprar créditos");

  const [pacote] = await sql<{ id: string; creditos: number; preco: string }[]>`
    SELECT id, creditos, preco FROM pacote_credito
     WHERE id = ${pacoteId} AND ativo
  `;
  if (!pacote) throw new Error("Pacote indisponível.");

  return comOrg(ctx.orgId, async (tx) => {
    const [pagamento] = await tx<
      { id: string; expira_em: Date | null }[]
    >`
      INSERT INTO pagamento (org_id, tipo, descricao, valor, metodo, status,
                             pacote_id, expira_em)
      VALUES (${ctx.orgId}, 'creditos',
              ${`Pacote de ${pacote.creditos.toLocaleString("pt-BR")} créditos`},
              ${pacote.preco}, 'pix', 'pendente', ${pacote.id},
              now() + interval '30 minutes')
      RETURNING id, expira_em
    `;

    return {
      pagamentoId: pagamento.id,
      valor: centavos(pacote.preco),
      pixCopiaCola: null,
      qrBase64: null,
      expiraEm: pagamento.expira_em,
    };
  });
}

/**
 * Registra a intenção de assinar/trocar de plano.
 *
 * Também não muda a assinatura: cria o pagamento pendente e espera o webhook.
 * Trocar o plano no clique daria acesso ao plano Completo para quem só abriu a
 * tela de PIX. O único caso que muda estado na hora é *descer* de plano, e nem
 * esse — descer vale no fim do ciclo já pago, senão o cliente perde o que
 * comprou.
 */
export async function contratarPlano(
  planoId: string,
  periodicidade: "mensal" | "semestral" | "anual",
): Promise<CobrancaPix> {
  const ctx = await exigirPapel("admin", "mudar o plano");

  const [preco] = await sql<
    { plano_nome: string; preco_total: string; meses: number }[]
  >`
    SELECT p.nome AS plano_nome, pp.preco_total, pp.meses
      FROM plano_preco pp
      JOIN plano p ON p.id = pp.plano_id
     WHERE pp.plano_id = ${planoId}
       AND pp.periodicidade = ${periodicidade}::periodicidade
       AND pp.ativo AND p.ativo
  `;
  if (!preco) throw new Error("Plano indisponível nessa periodicidade.");

  return comOrg(ctx.orgId, async (tx) => {
    const [assinatura] = await tx<{ id: string }[]>`
      SELECT id FROM assinatura
       WHERE status IN ('trial','ativa','inadimplente')
       ORDER BY criado_em DESC LIMIT 1
    `;

    const [pagamento] = await tx<{ id: string; expira_em: Date | null }[]>`
      INSERT INTO pagamento (org_id, tipo, descricao, valor, metodo, status,
                             assinatura_id, expira_em)
      VALUES (${ctx.orgId}, 'assinatura',
              ${`Plano ${preco.plano_nome} — ${periodicidade}`},
              ${preco.preco_total}, 'pix', 'pendente',
              ${assinatura?.id ?? null}, now() + interval '30 minutes')
      RETURNING id, expira_em
    `;

    return {
      pagamentoId: pagamento.id,
      valor: centavos(preco.preco_total),
      pixCopiaCola: null,
      qrBase64: null,
      expiraEm: pagamento.expira_em,
    };
  });
}

/**
 * Liga/desliga a renovação automática da assinatura vigente.
 *
 * Cancelar aqui não derruba o acesso na hora: `expira_em` continua valendo, e
 * é isso que o cliente espera de algo que ele já pagou.
 */
export async function definirRenovacao(automatica: boolean): Promise<void> {
  const ctx = await exigirPapel("admin", "mudar a renovação do plano");

  await comOrg(ctx.orgId, async (tx) => {
    await tx`
      UPDATE assinatura
         SET renovacao_automatica = ${automatica},
             atualizado_em = now()
       WHERE status IN ('trial','ativa','inadimplente')
    `;
  });
}
