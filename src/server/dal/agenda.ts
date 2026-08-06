import "server-only";

import { z } from "zod";

import { comOrg, centavos } from "../db";
import { normalizarE164 } from "../dominio/telefone";
import { dataLocalDe, instanteDaHoraLocal, type DataLocal } from "../dominio/tempo";
import { exigirContexto } from "./contexto";
import { ErroDeUso } from "../actions/comum";

/**
 * Agenda: serviços, horários e bloqueios.
 *
 * Duas regras nasceram no banco e não se repetem aqui: a exclusão GiST que
 * impede overbooking (`ex_agendamento_sobreposto`) e o CHECK de intervalo.
 * Quando o insert bate nelas, traduzimos o código `23P01` em mensagem de gente.
 * Validar antes em JS seria um segundo lugar para a regra viver — e o segundo
 * lugar é sempre o que fica desatualizado.
 *
 * Todo horário entra e sai como instante (`timestamptz`); a data/hora local só
 * existe na borda, convertida com o fuso da organização.
 */

export interface ServicoDTO {
  id: string;
  nome: string;
  duracaoMin: number;
  intervaloMin: number;
  preco: number | null;
  ativo: boolean;
  /** Agendamentos futuros que usam este serviço — trava a exclusão na UI. */
  agendamentosFuturos: number;
}

export interface AgendamentoDTO {
  id: string;
  contatoId: string;
  contatoNome: string;
  contatoTelefone: string;
  servicoId: string | null;
  servicoNome: string | null;
  inicio: Date;
  fim: Date;
  status: "pendente" | "confirmado" | "cancelado" | "concluido" | "faltou";
  origem: "ia" | "manual" | "api";
  observacao: string | null;
  conversaId: string | null;
}

export interface BloqueioDTO {
  id: string;
  motivo: string | null;
  inicio: Date;
  fim: Date;
}

export interface PainelAgenda {
  /** Dia âncora da visão, em `YYYY-MM-DD` no fuso da organização. */
  dia: DataLocal;
  fuso: string;
  agendamentos: AgendamentoDTO[];
  bloqueios: BloqueioDTO[];
  servicos: ServicoDTO[];
  expediente: { inicio: string; fim: string; diasSemana: number[] };
  resumo: {
    hoje: number;
    semana: number;
    pendentesConfirmacao: number;
    taxaComparecimento: number | null;
  };
}

const SELECT_AGENDAMENTO = (tx: Tx) => tx`
  a.id, a.contato_id, ct.nome AS contato_nome, ct.telefone_e164 AS contato_telefone,
  a.servico_id, s.nome AS servico_nome, a.inicio, a.fim, a.status, a.origem,
  a.observacao, a.conversa_id
`;

type Tx = Parameters<Parameters<typeof comOrg>[1]>[0];

interface LinhaAgendamento {
  id: string;
  contato_id: string;
  contato_nome: string;
  contato_telefone: string;
  servico_id: string | null;
  servico_nome: string | null;
  inicio: Date;
  fim: Date;
  status: AgendamentoDTO["status"];
  origem: AgendamentoDTO["origem"];
  observacao: string | null;
  conversa_id: string | null;
}

function paraAgendamento(l: LinhaAgendamento): AgendamentoDTO {
  return {
    id: l.id,
    contatoId: l.contato_id,
    contatoNome: l.contato_nome,
    contatoTelefone: l.contato_telefone,
    servicoId: l.servico_id,
    servicoNome: l.servico_nome,
    inicio: l.inicio,
    fim: l.fim,
    status: l.status,
    origem: l.origem,
    observacao: l.observacao,
    conversaId: l.conversa_id,
  };
}

/**
 * Carrega a semana que contém `dia` (segunda a domingo, como o brasileiro lê
 * calendário), mais o catálogo de serviços e o expediente configurado.
 */
export async function painelAgenda(dia?: DataLocal): Promise<PainelAgenda> {
  const ctx = await exigirContexto();

  return comOrg(ctx.orgId, async (tx) => {
    const [org] = await tx<
      {
        fuso: string;
        horario_inicio: string;
        horario_fim: string;
        dias_semana: number[];
      }[]
    >`
      SELECT fuso, horario_inicio, horario_fim, dias_semana
        FROM organizacao WHERE id = ${ctx.orgId}
    `;

    const ancora = dia ?? dataLocalDe(new Date(), org.fuso);

    const agendamentos = await tx<LinhaAgendamento[]>`
      SELECT ${SELECT_AGENDAMENTO(tx)}
        FROM agendamento a
        JOIN contato ct ON ct.id = a.contato_id
        LEFT JOIN servico s ON s.id = a.servico_id
       WHERE a.inicio >= (date_trunc('week', ${ancora}::date) AT TIME ZONE ${org.fuso})
         AND a.inicio <  (date_trunc('week', ${ancora}::date) + interval '7 days'
                          AT TIME ZONE ${org.fuso})
       ORDER BY a.inicio
    `;

    const bloqueios = await tx<
      { id: string; motivo: string | null; inicio: Date; fim: Date }[]
    >`
      SELECT id, motivo, inicio, fim
        FROM bloqueio_agenda
       WHERE fim >= (date_trunc('week', ${ancora}::date) AT TIME ZONE ${org.fuso})
         AND inicio < (date_trunc('week', ${ancora}::date) + interval '7 days'
                       AT TIME ZONE ${org.fuso})
       ORDER BY inicio
    `;

    const servicos = await tx<
      {
        id: string;
        nome: string;
        duracao_min: number;
        intervalo_min: number;
        preco: string | null;
        ativo: boolean;
        futuros: string;
      }[]
    >`
      SELECT s.id, s.nome, s.duracao_min, s.intervalo_min, s.preco, s.ativo,
             COALESCE((
               SELECT count(*) FROM agendamento a
                WHERE a.servico_id = s.id AND a.inicio > now()
                  AND a.status IN ('pendente','confirmado')
             ), 0)::text AS futuros
        FROM servico s
       ORDER BY s.ativo DESC, s.nome
    `;

    const [resumo] = await tx<
      {
        hoje: string;
        semana: string;
        pendentes: string;
        concluidos: string;
        faltou: string;
      }[]
    >`
      SELECT count(*) FILTER (
               WHERE (inicio AT TIME ZONE ${org.fuso})::date
                     = (now() AT TIME ZONE ${org.fuso})::date
                 AND status IN ('pendente','confirmado')
             )::text AS hoje,
             count(*) FILTER (
               WHERE inicio BETWEEN now() AND now() + interval '7 days'
                 AND status IN ('pendente','confirmado')
             )::text AS semana,
             count(*) FILTER (WHERE status = 'pendente' AND inicio > now())::text AS pendentes,
             count(*) FILTER (
               WHERE status = 'concluido' AND inicio > now() - interval '90 days'
             )::text AS concluidos,
             count(*) FILTER (
               WHERE status = 'faltou' AND inicio > now() - interval '90 days'
             )::text AS faltou
        FROM agendamento
    `;

    const concluidos = Number(resumo.concluidos);
    const faltou = Number(resumo.faltou);
    const fechados = concluidos + faltou;

    return {
      dia: ancora,
      fuso: org.fuso,
      agendamentos: agendamentos.map(paraAgendamento),
      bloqueios,
      servicos: servicos.map((s) => ({
        id: s.id,
        nome: s.nome,
        duracaoMin: s.duracao_min,
        intervaloMin: s.intervalo_min,
        preco: s.preco === null ? null : centavos(s.preco),
        ativo: s.ativo,
        agendamentosFuturos: Number(s.futuros),
      })),
      expediente: {
        inicio: org.horario_inicio.slice(0, 5),
        fim: org.horario_fim.slice(0, 5),
        diasSemana: org.dias_semana ?? [],
      },
      resumo: {
        hoje: Number(resumo.hoje),
        semana: Number(resumo.semana),
        pendentesConfirmacao: Number(resumo.pendentes),
        // Sem histórico suficiente a taxa é ruído; `null` deixa a UI dizer
        // "ainda não dá para saber" em vez de estampar 0% ou 100%.
        taxaComparecimento: fechados >= 5 ? Math.round((concluidos / fechados) * 100) : null,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Escrita

export const EntradaAgendamento = z.object({
  contatoNome: z.string().trim().min(2, "Diga o nome de quem vai ser atendido.").max(120),
  contatoTelefone: z.string().trim().min(8, "Telefone incompleto."),
  servicoId: z.string().uuid().optional().or(z.literal("")),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."),
  hora: z.string().regex(/^\d{2}:\d{2}$/, "Hora inválida."),
  duracaoMin: z.coerce.number().int().min(5).max(600).default(60),
  observacao: z.string().trim().max(500).optional(),
});

export type EntradaAgendamento = z.infer<typeof EntradaAgendamento>;

/**
 * Cria (ou reaproveita) o contato e agenda o horário.
 *
 * O contato entra por `ON CONFLICT (org_id, telefone_e164)`: quem marca por
 * telefone quase sempre já está na base, e criar duplicata quebraria a régua de
 * cobrança dessa mesma pessoa depois.
 */
export async function criarAgendamento(
  entrada: EntradaAgendamento,
): Promise<{ id: string }> {
  const ctx = await exigirContexto();
  const telefone = normalizarE164(entrada.contatoTelefone);
  if (!telefone) throw new ErroDeUso("Telefone inválido.");

  return comOrg(ctx.orgId, async (tx) => {
    const [org] = await tx<{ fuso: string }[]>`
      SELECT fuso FROM organizacao WHERE id = ${ctx.orgId}
    `;

    const inicio = instanteDaHoraLocal(entrada.data, entrada.hora, org.fuso);

    let duracao = entrada.duracaoMin;
    if (entrada.servicoId) {
      const [servico] = await tx<{ duracao_min: number }[]>`
        SELECT duracao_min FROM servico WHERE id = ${entrada.servicoId}
      `;
      if (servico) duracao = servico.duracao_min;
    }
    const fim = new Date(inicio.getTime() + duracao * 60_000);

    const [contato] = await tx<{ id: string }[]>`
      INSERT INTO contato (org_id, nome, telefone_e164)
      VALUES (${ctx.orgId}, ${entrada.contatoNome}, ${telefone})
      ON CONFLICT (org_id, telefone_e164)
        DO UPDATE SET nome = EXCLUDED.nome, atualizado_em = now()
      RETURNING id
    `;

    try {
      const [ag] = await tx<{ id: string }[]>`
        INSERT INTO agendamento (org_id, contato_id, servico_id, inicio, fim,
                                 status, origem, observacao)
        VALUES (${ctx.orgId}, ${contato.id},
                ${entrada.servicoId || null}, ${inicio}, ${fim},
                'confirmado', 'manual', ${entrada.observacao ?? null})
        RETURNING id
      `;
      return { id: ag.id };
    } catch (erro) {
      // 23P01 = exclusion_violation: a constraint GiST barrou o overbooking.
      if ((erro as { code?: string }).code === "23P01") {
        throw new ErroDeUso("Já existe um agendamento nesse horário.");
      }
      throw erro;
    }
  });
}

export async function mudarStatusAgendamento(
  id: string,
  status: AgendamentoDTO["status"],
): Promise<void> {
  const ctx = await exigirContexto();
  await comOrg(ctx.orgId, async (tx) => {
    await tx`UPDATE agendamento SET status = ${status} WHERE id = ${id}`;
  });
}

export const EntradaServico = z.object({
  id: z.string().uuid().optional().or(z.literal("")),
  nome: z.string().trim().min(2, "Dê um nome ao serviço.").max(80),
  duracaoMin: z.coerce.number().int().min(5).max(600),
  intervaloMin: z.coerce.number().int().min(0).max(240).default(0),
  precoCentavos: z.coerce.number().int().min(0).nullable().default(null),
  ativo: z.coerce.boolean().default(true),
});

export type EntradaServico = z.infer<typeof EntradaServico>;

export async function salvarServico(entrada: EntradaServico): Promise<{ id: string }> {
  const ctx = await exigirContexto();

  return comOrg(ctx.orgId, async (tx) => {
    if (entrada.id) {
      const [s] = await tx<{ id: string }[]>`
        UPDATE servico
           SET nome = ${entrada.nome}, duracao_min = ${entrada.duracaoMin},
               intervalo_min = ${entrada.intervaloMin},
               preco = ${entrada.precoCentavos}, ativo = ${entrada.ativo}
         WHERE id = ${entrada.id}
        RETURNING id
      `;
      if (!s) throw new ErroDeUso("Serviço não encontrado.");
      return { id: s.id };
    }

    const [s] = await tx<{ id: string }[]>`
      INSERT INTO servico (org_id, nome, duracao_min, intervalo_min, preco, ativo)
      VALUES (${ctx.orgId}, ${entrada.nome}, ${entrada.duracaoMin},
              ${entrada.intervaloMin}, ${entrada.precoCentavos}, ${entrada.ativo})
      ON CONFLICT (org_id, nome) DO UPDATE
        SET duracao_min = EXCLUDED.duracao_min,
            intervalo_min = EXCLUDED.intervalo_min,
            preco = EXCLUDED.preco,
            ativo = EXCLUDED.ativo
      RETURNING id
    `;
    return { id: s.id };
  });
}

/**
 * Bloqueia uma faixa da agenda (almoço, folga, feriado).
 *
 * Bloqueio não conflita com agendamento existente de propósito: se o dentista
 * marcou férias em cima de uma consulta, ele precisa ver a consulta lá para
 * remarcar — apagar ou recusar silenciosamente seria pior.
 */
export async function criarBloqueio(
  inicio: Date,
  fim: Date,
  motivo?: string,
): Promise<void> {
  const ctx = await exigirContexto();
  if (fim <= inicio) throw new ErroDeUso("O fim precisa ser depois do início.");

  await comOrg(ctx.orgId, async (tx) => {
    await tx`
      INSERT INTO bloqueio_agenda (org_id, motivo, inicio, fim)
      VALUES (${ctx.orgId}, ${motivo ?? null}, ${inicio}, ${fim})
    `;
  });
}

export async function removerBloqueio(id: string): Promise<void> {
  const ctx = await exigirContexto();
  await comOrg(ctx.orgId, async (tx) => {
    await tx`DELETE FROM bloqueio_agenda WHERE id = ${id}`;
  });
}
