import "server-only";

import { comOrg } from "../db";
import { exigirContexto, podeVerFinanceiro, type Papel } from "./contexto";

/**
 * Leituras que alimentam o casco do painel (menu lateral, topo) e a visão geral.
 *
 * Existe separado da DAL de cada módulo porque é agregação de tudo: o menu
 * precisa saber quantas conversas estão sem ler, qual plano libera qual item e
 * quanto crédito sobrou. Fazer a página pedir isso a seis DALs diferentes daria
 * seis round-trips para desenhar uma barra de progresso.
 *
 * Tudo aqui roda dentro de `comOrg` — RLS ligado, org do contexto. Nenhuma
 * função recebe `orgId` por parâmetro: quem escolhe a organização é o cookie de
 * sessão validado em `exigirContexto`, nunca a página.
 */

export type Feature = "atendimento" | "cobranca" | "agendamento";

export interface SessaoPainel {
  usuario: { id: string; nome: string; email: string; papel: Papel };
  org: {
    id: string;
    nome: string;
    nomeAtendente: string;
    fuso: string;
    totalOrgs: number;
  };
  plano: {
    id: string;
    nome: string;
    features: Feature[];
    /** `null` enquanto a organização está em trial sem plano escolhido. */
    status: string | null;
    expiraEm: Date | null;
  };
  creditos: {
    totais: number;
    usados: number;
    restantes: number;
    /** 0–100, já arredondado e limitado — a UI só desenha a barra. */
    percentual: number;
  };
  conexoes: { conectadas: number; totais: number; comProblema: number };
  naoLidas: number;
  /** Atendente não vê preço, fatura nem saldo. */
  verFinanceiro: boolean;
}

interface LinhaSessao {
  nome_atendente: string;
  fuso: string;
  saldo_creditos: string;
  plano_id: string | null;
  plano_nome: string | null;
  features: Feature[] | null;
  creditos_mes: number | null;
  conexoes_inclusas: number | null;
  conexoes_extras: number | null;
  status_assinatura: string | null;
  expira_em: Date | null;
  comprados_ciclo: string;
  usados_ciclo: string;
  conexoes_conectadas: number;
  conexoes_problema: number;
  nao_lidas: string;
}

export async function carregarSessaoPainel(): Promise<SessaoPainel> {
  const ctx = await exigirContexto();

  return comOrg(ctx.orgId, async (tx) => {
    /*
     * Uma consulta só. Os subselects são todos por índice e sobre a partição da
     * própria organização (RLS já filtrou), então sai mais barato que abrir seis
     * transações — o custo aqui é dominado por round-trip, não por CPU.
     *
     * O ciclo de crédito fecha no primeiro dia do mês *no fuso da empresa*: é o
     * que o cliente vê no extrato, e é como `mensagens_mes` já contava em
     * conexões. Duas contagens com corte diferente na mesma tela é bug de
     * confiança.
     */
    const [l] = await tx<LinhaSessao[]>`
      WITH ciclo AS (
        SELECT date_trunc('month', now() AT TIME ZONE o.fuso) AT TIME ZONE o.fuso AS inicio
          FROM organizacao o WHERE o.id = ${ctx.orgId}
      )
      SELECT o.nome_atendente,
             o.fuso,
             o.saldo_creditos,
             p.id                AS plano_id,
             p.nome              AS plano_nome,
             p.features,
             p.creditos_mes,
             p.conexoes_inclusas,
             a.conexoes_extras,
             a.status            AS status_assinatura,
             a.expira_em,
             COALESCE((
               SELECT sum(mc.quantidade) FROM movimento_credito mc, ciclo
                WHERE mc.quantidade > 0
                  AND mc.origem_tipo = 'pagamento'
                  AND mc.criado_em >= ciclo.inicio
             ), 0) AS comprados_ciclo,
             COALESCE((
               SELECT -sum(mc.quantidade) FROM movimento_credito mc, ciclo
                WHERE mc.quantidade < 0
                  AND mc.criado_em >= ciclo.inicio
             ), 0) AS usados_ciclo,
             COALESCE((
               SELECT count(*) FROM canal_whatsapp c WHERE c.status = 'conectado'
             ), 0)::int AS conexoes_conectadas,
             COALESCE((
               SELECT count(*) FROM canal_whatsapp c WHERE c.status = 'erro'
             ), 0)::int AS conexoes_problema,
             COALESCE((
               SELECT sum(cv.nao_lidas) FROM conversa cv WHERE cv.arquivada_em IS NULL
             ), 0) AS nao_lidas
        FROM organizacao o
        LEFT JOIN assinatura a
               ON a.org_id = o.id
              AND a.status IN ('trial', 'ativa', 'inadimplente')
        LEFT JOIN plano p ON p.id = a.plano_id
       WHERE o.id = ${ctx.orgId}
       -- Assinatura cancelada e recriada deixa duas linhas; a viva é a mais nova.
       ORDER BY a.criado_em DESC NULLS LAST
       LIMIT 1
    `;

    const comprados = Number(l.comprados_ciclo);
    const totais = (l.creditos_mes ?? 0) + comprados;
    const usados = Number(l.usados_ciclo);
    const restantes = Number(l.saldo_creditos);

    return {
      usuario: {
        id: ctx.usuarioId,
        nome: ctx.nome,
        email: ctx.email,
        papel: ctx.papel,
      },
      org: {
        id: ctx.orgId,
        nome: ctx.orgNome,
        nomeAtendente: l.nome_atendente,
        fuso: l.fuso,
        totalOrgs: ctx.totalOrgs,
      },
      plano: {
        id: l.plano_id ?? "essencial",
        nome: l.plano_nome ?? "Trial",
        features: l.features ?? ["atendimento"],
        status: l.status_assinatura,
        expiraEm: l.expira_em,
      },
      creditos: {
        totais,
        usados,
        restantes,
        // Sem plano ainda: 0% é mais honesto que dividir por zero e mostrar NaN.
        percentual: totais > 0 ? Math.min(100, Math.round((usados / totais) * 100)) : 0,
      },
      conexoes: {
        conectadas: l.conexoes_conectadas,
        totais: (l.conexoes_inclusas ?? 1) + (l.conexoes_extras ?? 0),
        comProblema: l.conexoes_problema,
      },
      naoLidas: Number(l.nao_lidas),
      verFinanceiro: podeVerFinanceiro(ctx.papel),
    };
  });
}

// ---------------------------------------------------------------------------
// Visão geral

export interface Pendencia {
  id: string;
  tipo: "conversa" | "cobranca" | "agendamento" | "conexao";
  texto: string;
  detalhe: string;
  href: string;
}

export interface Atividade {
  id: string;
  quando: Date;
  tipo: "conversa" | "cobranca" | "agendamento";
  texto: string;
}

export interface ResumoPainel {
  cobranca: {
    emAberto: number;
    vencidas: number;
    recebidoMes: number;
    /** Quanto a régua recuperou no mês: pago depois de pelo menos um envio. */
    recuperadoMes: number;
    disparosHoje: number;
  };
  atendimento: {
    conversasAtivas: number;
    naoLidas: number;
    respondidasIa: number;
    emHumano: number;
  };
  agenda: { hoje: number; semana: number; pendentes: number };
  pendencias: Pendencia[];
  atividades: Atividade[];
}

export async function resumoPainel(): Promise<ResumoPainel> {
  const ctx = await exigirContexto();

  return comOrg(ctx.orgId, async (tx) => {
    const [c] = await tx<
      {
        em_aberto: string;
        vencidas: string;
        recebido_mes: string;
        recuperado_mes: string;
        disparos_hoje: string;
      }[]
    >`
      WITH ciclo AS (
        SELECT date_trunc('month', now() AT TIME ZONE o.fuso) AT TIME ZONE o.fuso AS inicio
          FROM organizacao o WHERE o.id = ${ctx.orgId}
      )
      SELECT COALESCE(sum(cb.valor) FILTER (
               WHERE cb.status IN ('pendente','negociando','vencido')), 0) AS em_aberto,
             COALESCE(count(*)     FILTER (WHERE cb.status = 'vencido'), 0) AS vencidas,
             COALESCE(sum(cb.valor_pago) FILTER (
               WHERE cb.status = 'pago' AND cb.pago_em >= (SELECT inicio FROM ciclo)), 0)
               AS recebido_mes,
             /*
              * "Recuperado" só conta quando houve envio antes do pagamento —
              * senão a régua levaria crédito por quem pagaria de qualquer jeito.
              */
             COALESCE(sum(cb.valor_pago) FILTER (
               WHERE cb.status = 'pago'
                 AND cb.pago_em >= (SELECT inicio FROM ciclo)
                 AND EXISTS (
                   SELECT 1 FROM disparo d
                    WHERE d.cobranca_id = cb.id AND d.status = 'enviado'
                      AND d.processado_em < cb.pago_em
                 )), 0) AS recuperado_mes,
             COALESCE((
               SELECT count(*) FROM disparo d, organizacao o2
                WHERE o2.id = ${ctx.orgId}
                  AND d.status = 'enviado'
                  AND d.processado_em >= date_trunc(
                        'day', now() AT TIME ZONE o2.fuso) AT TIME ZONE o2.fuso
             ), 0) AS disparos_hoje
        FROM cobranca cb
    `;

    const [a] = await tx<
      {
        conversas_ativas: string;
        nao_lidas: string;
        respondidas_ia: string;
        em_humano: string;
      }[]
    >`
      SELECT count(*) FILTER (WHERE cv.arquivada_em IS NULL)          AS conversas_ativas,
             COALESCE(sum(cv.nao_lidas), 0)                           AS nao_lidas,
             count(*) FILTER (WHERE cv.modo = 'ia')                   AS respondidas_ia,
             count(*) FILTER (WHERE cv.modo = 'humano')               AS em_humano
        FROM conversa cv
    `;

    const [g] = await tx<{ hoje: string; semana: string; pendentes: string }[]>`
      SELECT count(*) FILTER (
               WHERE ag.inicio >= date_trunc('day', now() AT TIME ZONE o.fuso) AT TIME ZONE o.fuso
                 AND ag.inicio <  (date_trunc('day', now() AT TIME ZONE o.fuso) + interval '1 day') AT TIME ZONE o.fuso
             ) AS hoje,
             count(*) FILTER (
               WHERE ag.inicio >= now() AND ag.inicio < now() + interval '7 days'
             ) AS semana,
             count(*) FILTER (WHERE ag.status = 'pendente' AND ag.inicio > now()) AS pendentes
        FROM agendamento ag
        JOIN organizacao o ON o.id = ${ctx.orgId}
       WHERE ag.status <> 'cancelado'
    `;

    /*
     * Pendências e atividades vêm de tabelas diferentes com o mesmo formato.
     * `UNION ALL` + ordenação no banco evita trazer três listas inteiras para
     * ordenar em JS e jogar 90% fora.
     */
    const pendencias = await tx<
      { id: string; tipo: Pendencia["tipo"]; texto: string; detalhe: string }[]
    >`
      (SELECT 'cv-' || cv.id AS id, 'conversa' AS tipo,
              ct.nome || ' — ' || cv.nao_lidas ||
                CASE WHEN cv.nao_lidas = 1 THEN ' mensagem não lida'
                     ELSE ' mensagens não lidas' END AS texto,
              to_char(cv.ultima_atividade_em, 'DD/MM HH24:MI') AS detalhe
         FROM conversa cv JOIN contato ct ON ct.id = cv.contato_id
        WHERE cv.nao_lidas > 0 AND cv.arquivada_em IS NULL
        ORDER BY cv.ultima_atividade_em DESC LIMIT 5)
      UNION ALL
      (SELECT 'cb-' || cb.id, 'cobranca',
              ct.nome || ' venceu há ' ||
                (now()::date - cb.vencimento) || ' dias',
              to_char(cb.valor / 100.0, 'FM"R$" 999G999D00')
         FROM cobranca cb JOIN contato ct ON ct.id = cb.contato_id
        WHERE cb.status = 'vencido' AND now()::date - cb.vencimento >= 7
        ORDER BY cb.vencimento LIMIT 5)
      UNION ALL
      (SELECT 'ag-' || ag.id, 'agendamento',
              ct.nome || ' aguarda confirmação',
              to_char(ag.inicio, 'DD/MM HH24:MI')
         FROM agendamento ag JOIN contato ct ON ct.id = ag.contato_id
        WHERE ag.status = 'pendente' AND ag.inicio > now()
        ORDER BY ag.inicio LIMIT 5)
      UNION ALL
      (SELECT 'cn-' || cn.id, 'conexao',
              cn.nome || ' está com problema',
              COALESCE(cn.ultimo_erro, 'reconecte o número')
         FROM canal_whatsapp cn
        WHERE cn.status = 'erro' LIMIT 3)
    `;

    const atividades = await tx<
      { id: string; quando: Date; tipo: Atividade["tipo"]; texto: string }[]
    >`
      SELECT id, quando, tipo, texto FROM (
        (SELECT 'm-' || m.id AS id, m.criado_em AS quando, 'conversa' AS tipo,
                ct.nome || ': ' || left(COALESCE(m.texto, '[mídia]'), 80) AS texto
           FROM mensagem m
           JOIN conversa cv ON cv.id = m.conversa_id
           JOIN contato ct  ON ct.id = cv.contato_id
          ORDER BY m.criado_em DESC LIMIT 10)
        UNION ALL
        (SELECT 'p-' || cb.id, cb.pago_em, 'cobranca',
                ct.nome || ' pagou ' || to_char(cb.valor_pago / 100.0, 'FM"R$" 999G999D00')
           FROM cobranca cb JOIN contato ct ON ct.id = cb.contato_id
          WHERE cb.status = 'pago' AND cb.pago_em IS NOT NULL
          ORDER BY cb.pago_em DESC LIMIT 10)
        UNION ALL
        (SELECT 'a-' || ag.id, ag.criado_em, 'agendamento',
                'Agendamento com ' || ct.nome
           FROM agendamento ag JOIN contato ct ON ct.id = ag.contato_id
          ORDER BY ag.criado_em DESC LIMIT 10)
      ) t
      ORDER BY quando DESC
      LIMIT 8
    `;

    return {
      cobranca: {
        emAberto: Number(c.em_aberto),
        vencidas: Number(c.vencidas),
        recebidoMes: Number(c.recebido_mes),
        recuperadoMes: Number(c.recuperado_mes),
        disparosHoje: Number(c.disparos_hoje),
      },
      atendimento: {
        conversasAtivas: Number(a.conversas_ativas),
        naoLidas: Number(a.nao_lidas),
        respondidasIa: Number(a.respondidas_ia),
        emHumano: Number(a.em_humano),
      },
      agenda: {
        hoje: Number(g.hoje),
        semana: Number(g.semana),
        pendentes: Number(g.pendentes),
      },
      pendencias: pendencias.map((p) => ({
        ...p,
        href:
          p.tipo === "conversa"
            ? "/painel/atendimento"
            : p.tipo === "cobranca"
              ? "/painel/cobranca"
              : p.tipo === "agendamento"
                ? "/painel/agenda"
                : "/painel/conexoes",
      })),
      atividades,
    };
  });
}

// ---------------------------------------------------------------------------
// Série de uso da visão geral

export interface DiaDeUso {
  /** `YYYY-MM-DD` no fuso da organização. */
  dia: string;
  atendimento: number;
  cobranca: number;
  agendamento: number;
}

/**
 * Últimos 14 dias de consumo por finalidade, do mais antigo ao mais recente.
 *
 * Vive aqui e não em `creditos.ts` porque a visão geral mostra o gráfico para
 * qualquer papel: consumo é operação, não dinheiro. `painelCreditos` exige
 * `podeVerFinanceiro` e traz catálogo, faturas e assinatura junto — carregar
 * tudo aquilo para desenhar quatorze barras seria caro e barraria o atendente.
 */
export async function usoDiario(): Promise<DiaDeUso[]> {
  const ctx = await exigirContexto();

  return comOrg(ctx.orgId, async (tx) => {
    /*
     * `generate_series` garante os 14 dias mesmo sem uso: gráfico com buraco
     * mente sobre a tendência.
     */
    const linhas = await tx<
      { dia: string; atendimento: string; cobranca: string; agendamento: string }[]
    >`
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

    return linhas.map((l) => ({
      dia: l.dia,
      atendimento: Number(l.atendimento),
      cobranca: Number(l.cobranca),
      agendamento: Number(l.agendamento),
    }));
  });
}
