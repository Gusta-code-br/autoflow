import "server-only";

import { z } from "zod";

import { type Transacao, comOrg } from "../db";
import { exigirContexto, exigirPapel } from "./contexto";
import { auditar } from "./organizacao";
import { descreverEtapa } from "../dominio/regua";
import type { AcaoEtapa, Condicao, Referencia } from "../dominio/regua";
import { validarTemplate } from "../dominio/variaveis";

/**
 * Réguas de cobrança: a automação que o cliente monta.
 *
 * Duas regras não óbvias moram aqui, e são o motivo deste arquivo existir em
 * vez de um CRUD genérico:
 *
 * 1. Etapa com histórico nunca é apagada. `disparo.etapa_id` tem ON DELETE
 *    CASCADE, então um `DELETE` levaria junto o registro dos envios já feitos —
 *    a prova de "mandamos sim, no dia tal". Etapa que já disparou é desativada.
 *
 * 2. Editar a régua não reescreve o que já está agendado para cobranças em
 *    andamento. Reagendar tudo mudaria, sem aviso, mensagens que sairiam hoje.
 *    O que a edição faz é cancelar os disparos futuros das etapas que saíram
 *    ou foram desligadas — esses, se ficassem, o worker executaria sozinhos.
 */

export interface EtapaDTO {
  id: string;
  ordem: number;
  referencia: Referencia;
  offsetDias: number;
  hora: string;
  condicao: Condicao;
  acao: AcaoEtapa;
  mensagem: string | null;
  templateId: string | null;
  anexarPix: boolean;
  ativa: boolean;
  /** Frase pronta para a tela: "3 dias depois do vencimento, às 09:00". */
  descricao: string;
}

export interface ReguaDTO {
  id: string;
  nome: string;
  descricao: string | null;
  ativa: boolean;
  aplicarA: "todas" | "tag";
  tag: string | null;
  pausarAoResponder: boolean;
  pausarAoPagar: boolean;
  padrao: boolean;
  etapas: EtapaDTO[];
  /** Cobranças com execução ativa nesta régua agora. */
  emAndamento: number;
}

export interface ReguaResumo {
  id: string;
  nome: string;
  descricao: string | null;
  ativa: boolean;
  padrao: boolean;
  aplicarA: "todas" | "tag";
  tag: string | null;
  totalEtapas: number;
  emAndamento: number;
  /** Primeira e última etapa, para a tela mostrar o alcance sem abrir. */
  resumoEtapas: string[];
}

// ---------------------------------------------------------------------------
// Leitura

export async function listarReguas(): Promise<ReguaResumo[]> {
  const ctx = await exigirContexto();

  return comOrg(ctx.orgId, async (tx) => {
    const linhas = await tx<
      {
        id: string;
        nome: string;
        descricao: string | null;
        ativa: boolean;
        padrao: boolean;
        aplicar_a: "todas" | "tag";
        tag: string | null;
        total_etapas: number;
        em_andamento: number;
      }[]
    >`
      SELECT r.id, r.nome, r.descricao, r.ativa, r.padrao, r.aplicar_a, r.tag,
             (SELECT count(*)::int FROM regua_etapa e
               WHERE e.regua_id = r.id AND e.ativa)                AS total_etapas,
             (SELECT count(*)::int FROM regua_execucao x
               WHERE x.regua_id = r.id AND x.status = 'ativa')     AS em_andamento
        FROM regua r
       WHERE r.arquivada_em IS NULL
       ORDER BY r.padrao DESC, r.ativa DESC, r.nome
    `;

    if (linhas.length === 0) return [];

    const etapas = await tx<
      {
        regua_id: string;
        referencia: Referencia;
        offset_dias: number;
        hora: string;
        condicao: Condicao;
        acao: AcaoEtapa;
        ordem: number;
      }[]
    >`
      SELECT e.regua_id, e.referencia, e.offset_dias, e.hora::text,
             e.condicao, e.acao, e.ordem
        FROM regua_etapa e
       WHERE e.regua_id = ANY(${linhas.map((l) => l.id)}::uuid[]) AND e.ativa
       ORDER BY e.regua_id, e.ordem
    `;

    return linhas.map((l) => ({
      id: l.id,
      nome: l.nome,
      descricao: l.descricao,
      ativa: l.ativa,
      padrao: l.padrao,
      aplicarA: l.aplicar_a,
      tag: l.tag,
      totalEtapas: l.total_etapas,
      emAndamento: l.em_andamento,
      resumoEtapas: etapas
        .filter((e) => e.regua_id === l.id)
        .map((e) =>
          descreverEtapa({
            id: "",
            ordem: e.ordem,
            referencia: e.referencia,
            offsetDias: e.offset_dias,
            hora: e.hora.slice(0, 5),
            condicao: e.condicao,
            acao: e.acao,
            ativa: true,
          }),
        ),
    }));
  });
}

export async function buscarRegua(id: string): Promise<ReguaDTO | null> {
  const ctx = await exigirContexto();

  return comOrg(ctx.orgId, async (tx) => {
    const [r] = await tx<
      {
        id: string;
        nome: string;
        descricao: string | null;
        ativa: boolean;
        aplicar_a: "todas" | "tag";
        tag: string | null;
        pausar_ao_responder: boolean;
        pausar_ao_pagar: boolean;
        padrao: boolean;
        em_andamento: number;
      }[]
    >`
      SELECT r.id, r.nome, r.descricao, r.ativa, r.aplicar_a, r.tag,
             r.pausar_ao_responder, r.pausar_ao_pagar, r.padrao,
             (SELECT count(*)::int FROM regua_execucao x
               WHERE x.regua_id = r.id AND x.status = 'ativa') AS em_andamento
        FROM regua r
       WHERE r.id = ${id} AND r.arquivada_em IS NULL
    `;
    if (!r) return null;

    const etapas = await lerEtapas(tx, id);

    return {
      id: r.id,
      nome: r.nome,
      descricao: r.descricao,
      ativa: r.ativa,
      aplicarA: r.aplicar_a,
      tag: r.tag,
      pausarAoResponder: r.pausar_ao_responder,
      pausarAoPagar: r.pausar_ao_pagar,
      padrao: r.padrao,
      etapas,
      emAndamento: r.em_andamento,
    };
  });
}

async function lerEtapas(tx: Transacao, reguaId: string): Promise<EtapaDTO[]> {
  const linhas = await tx<
    {
      id: string;
      ordem: number;
      referencia: Referencia;
      offset_dias: number;
      hora: string;
      condicao: Condicao;
      acao: AcaoEtapa;
      mensagem: string | null;
      template_id: string | null;
      anexar_pix: boolean;
      ativa: boolean;
    }[]
  >`
    SELECT id, ordem, referencia, offset_dias, hora::text, condicao, acao,
           mensagem, template_id, anexar_pix, ativa
      FROM regua_etapa
     WHERE regua_id = ${reguaId}
     -- etapas desativadas ficam com ordem negativa (ver sincronizarEtapas):
     -- elas vão para o fim da lista, não para o começo.
     ORDER BY ativa DESC, ordem
  `;

  return linhas.map((e) => ({
    id: e.id,
    ordem: e.ordem,
    referencia: e.referencia,
    offsetDias: e.offset_dias,
    hora: e.hora.slice(0, 5),
    condicao: e.condicao,
    acao: e.acao,
    mensagem: e.mensagem,
    templateId: e.template_id,
    anexarPix: e.anexar_pix,
    ativa: e.ativa,
    descricao: descreverEtapa({
      id: e.id,
      ordem: e.ordem,
      referencia: e.referencia,
      offsetDias: e.offset_dias,
      hora: e.hora.slice(0, 5),
      condicao: e.condicao,
      acao: e.acao,
      ativa: e.ativa,
    }),
  }));
}

// ---------------------------------------------------------------------------
// Escrita

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export const EntradaEtapa = z.object({
  /** Presente = etapa que já existe; ausente = etapa nova. */
  id: z.string().uuid().nullable().optional(),
  referencia: z.enum(["emissao", "vencimento", "pagamento"]),
  offsetDias: z.number().int().min(-365, "no máximo 365 dias").max(365, "no máximo 365 dias"),
  hora: z.string().regex(HORA, "hora inválida (use HH:MM)"),
  condicao: z.enum(["sempre", "se_nao_pago", "se_pago", "se_sem_resposta"]),
  acao: z.enum([
    "enviar_whatsapp",
    "notificar_voce",
    "oferecer_parcelamento",
    "marcar_perdido",
  ]),
  mensagem: z.string().trim().max(1000).optional(),
  templateId: z.string().uuid().nullable().optional(),
  anexarPix: z.boolean().default(false),
  ativa: z.boolean().default(true),
});
export type EntradaEtapa = z.infer<typeof EntradaEtapa>;

export const EntradaRegua = z
  .object({
    nome: z.string().trim().min(2, "dê um nome à régua").max(80),
    descricao: z.string().trim().max(300).optional(),
    ativa: z.boolean().default(true),
    aplicarA: z.enum(["todas", "tag"]).default("todas"),
    tag: z.string().trim().max(40).optional(),
    pausarAoResponder: z.boolean().default(true),
    pausarAoPagar: z.boolean().default(true),
    padrao: z.boolean().default(false),
    // 30 etapas já é muito; o limite existe para o editor não virar um jeito de
    // agendar 200 mensagens por cobrança sem querer.
    etapas: z.array(EntradaEtapa).min(1, "adicione ao menos uma etapa").max(30),
  })
  .superRefine((v, ctx) => {
    if (v.aplicarA === "tag" && !v.tag) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tag"],
        message: "informe a etiqueta que ativa esta régua",
      });
    }

    v.etapas.forEach((e, i) => {
      // O banco tem o CHECK equivalente; repetir aqui é o que transforma
      // "violação de constraint" em uma frase que o usuário entende, apontando
      // a etapa certa.
      if (e.acao === "enviar_whatsapp" && !e.mensagem && !e.templateId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["etapas", i, "mensagem"],
          message: "escreva a mensagem ou escolha um template",
        });
      }

      if (e.mensagem) {
        const r = validarTemplate(e.mensagem);
        if (!r.ok) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["etapas", i, "mensagem"],
            message: `variável desconhecida: ${r.desconhecidas.join(", ")}`,
          });
        }
      }
    });
  });
export type EntradaRegua = z.infer<typeof EntradaRegua>;

export interface ResultadoSalvar {
  id: string;
  avisos: string[];
}

/**
 * Cria ou substitui uma régua inteira (cabeçalho + etapas) numa transação só.
 *
 * O editor manda o desenho completo, não um diff: é o formato que sobrevive a
 * duas abas abertas e a um F5 no meio da edição.
 */
export async function salvarRegua(
  entrada: EntradaRegua,
  reguaId?: string,
): Promise<ResultadoSalvar> {
  const ctx = await exigirPapel("admin", "editar régua");
  const avisos: string[] = [];

  return comOrg(ctx.orgId, async (tx) => {
    const [regua] = reguaId
      ? await tx<{ id: string }[]>`
          UPDATE regua
             SET nome = ${entrada.nome},
                 descricao = ${entrada.descricao ?? null},
                 ativa = ${entrada.ativa},
                 aplicar_a = ${entrada.aplicarA},
                 tag = ${entrada.aplicarA === "tag" ? (entrada.tag ?? null) : null},
                 pausar_ao_responder = ${entrada.pausarAoResponder},
                 pausar_ao_pagar = ${entrada.pausarAoPagar},
                 atualizado_em = now()
           WHERE id = ${reguaId} AND arquivada_em IS NULL
       RETURNING id
        `
      : await tx<{ id: string }[]>`
          INSERT INTO regua (org_id, nome, descricao, ativa, aplicar_a, tag,
                             pausar_ao_responder, pausar_ao_pagar)
          VALUES (${ctx.orgId}, ${entrada.nome}, ${entrada.descricao ?? null},
                  ${entrada.ativa}, ${entrada.aplicarA},
                  ${entrada.aplicarA === "tag" ? (entrada.tag ?? null) : null},
                  ${entrada.pausarAoResponder}, ${entrada.pausarAoPagar})
       RETURNING id
        `;

    if (!regua) throw new Error("Régua não encontrada.");
    const id = regua.id;

    const removidas = await sincronizarEtapas(tx, id, entrada.etapas, avisos);
    const canceladas = await cancelarFuturos(tx, ctx.orgId, removidas);
    if (canceladas > 0) {
      avisos.push(
        canceladas === 1
          ? "1 mensagem que estava agendada por uma etapa removida foi cancelada."
          : `${canceladas} mensagens agendadas por etapas removidas foram canceladas.`,
      );
    }

    if (entrada.padrao) await marcarPadrao(tx, ctx.orgId, id);

    const emAndamento = await contarEmAndamento(tx, id);
    if (emAndamento > 0) {
      // Dizer isto agora evita o chamado "editei e não mudou nada".
      avisos.push(
        `${emAndamento} ${
          emAndamento === 1 ? "cobrança já está" : "cobranças já estão"
        } rodando com o desenho anterior. As mudanças valem para as próximas.`,
      );
    }

    await auditar(tx, ctx, reguaId ? "regua.editada" : "regua.criada", "regua", id, {
      nome: entrada.nome,
      etapas: entrada.etapas.length,
    });

    return { id, avisos };
  });
}

/**
 * Aplica o desenho novo às linhas de `regua_etapa` e devolve os ids das etapas
 * que deixaram de valer (apagadas ou desligadas).
 */
async function sincronizarEtapas(
  tx: Transacao,
  reguaId: string,
  etapas: EntradaEtapa[],
  avisos: string[],
): Promise<string[]> {
  const existentes = await tx<{ id: string; tem_historico: boolean }[]>`
    SELECT e.id,
           EXISTS (SELECT 1 FROM disparo d
                    WHERE d.etapa_id = e.id
                      AND d.status <> 'agendado') AS tem_historico
      FROM regua_etapa e
     WHERE e.regua_id = ${reguaId}
  `;
  const historico = new Map(existentes.map((e) => [e.id, e.tem_historico]));

  const mantidos = new Set<string>();
  const invalidadas: string[] = [];

  // A ordem no banco vem da posição no array; o editor arrasta e solta, não
  // digita número de ordem.
  //
  // `UNIQUE (regua_id, ordem)` não é adiável, então reordenar direto colide no
  // meio do caminho (a etapa 2 vira 1 enquanto a 1 ainda é 1). Antes de tudo,
  // todas as linhas existentes são jogadas para faixas negativas distintas,
  // liberando 1..n. As que sobreviverem à sincronização recebem a ordem nova;
  // as arquivadas ficam onde estão, fora do caminho.
  await tx`
    UPDATE regua_etapa e
       SET ordem = -s.rn
      FROM (
        SELECT id, row_number() OVER (ORDER BY ordem, id) AS rn
          FROM regua_etapa WHERE regua_id = ${reguaId}
      ) s
     WHERE e.id = s.id
  `;

  for (const [i, e] of etapas.entries()) {
    const ordem = i + 1;
    const conteudo = {
      referencia: e.referencia,
      offset_dias: e.offsetDias,
      hora: e.hora,
      condicao: e.condicao,
      acao: e.acao,
      mensagem: e.acao === "enviar_whatsapp" ? (e.mensagem ?? null) : null,
      template_id: e.acao === "enviar_whatsapp" ? (e.templateId ?? null) : null,
      anexar_pix: e.anexarPix,
      ativa: e.ativa,
    };

    if (e.id && historico.has(e.id)) {
      await tx`
        UPDATE regua_etapa SET ordem = ${ordem}, ${tx(conteudo)}
         WHERE id = ${e.id} AND regua_id = ${reguaId}
      `;
      mantidos.add(e.id);
      if (!e.ativa) invalidadas.push(e.id);
    } else {
      const [nova] = await tx<{ id: string }[]>`
        INSERT INTO regua_etapa ${tx({ regua_id: reguaId, ordem, ...conteudo })}
        RETURNING id
      `;
      mantidos.add(nova.id);
    }
  }

  for (const { id, tem_historico } of existentes) {
    if (mantidos.has(id)) continue;

    if (tem_historico) {
      // Guardar a etapa desligada é o que preserva o histórico dos envios que
      // ela já fez. Some da tela, continua no relatório. A ordem negativa que
      // ela recebeu acima já é única — deixá-la ali é o suficiente.
      await tx`UPDATE regua_etapa SET ativa = false WHERE id = ${id}`;
      avisos.push(
        "Uma etapa que já enviou mensagens foi desativada em vez de apagada, para preservar o histórico.",
      );
    } else {
      await tx`DELETE FROM regua_etapa WHERE id = ${id}`;
    }
    invalidadas.push(id);
  }

  return invalidadas;
}

/** Disparo agendado de etapa que não vale mais viraria envio fantasma. */
async function cancelarFuturos(
  tx: Transacao,
  orgId: string,
  etapaIds: string[],
): Promise<number> {
  if (etapaIds.length === 0) return 0;

  const linhas = await tx`
    UPDATE disparo
       SET status = 'cancelado',
           motivo_ignorado = 'etapa removida da régua',
           processado_em = now()
     WHERE org_id = ${orgId}
       AND status = 'agendado'
       AND etapa_id = ANY(${etapaIds}::uuid[])
  `;
  return linhas.count;
}

async function contarEmAndamento(tx: Transacao, reguaId: string): Promise<number> {
  const [r] = await tx<{ total: number }[]>`
    SELECT count(*)::int AS total FROM regua_execucao
     WHERE regua_id = ${reguaId} AND status = 'ativa'
  `;
  return r?.total ?? 0;
}

async function marcarPadrao(tx: Transacao, orgId: string, reguaId: string): Promise<void> {
  // Duas réguas padrão significam "qualquer uma" na hora de escolher sozinho —
  // por isso a troca é sempre exclusiva.
  await tx`UPDATE regua SET padrao = false WHERE org_id = ${orgId} AND id <> ${reguaId}`;
  await tx`UPDATE regua SET padrao = true, ativa = true WHERE id = ${reguaId}`;
}

export async function definirPadrao(reguaId: string): Promise<void> {
  const ctx = await exigirPapel("admin", "definir régua padrão");

  await comOrg(ctx.orgId, async (tx) => {
    const [r] = await tx<{ id: string; tem_etapa: boolean }[]>`
      SELECT r.id,
             EXISTS (SELECT 1 FROM regua_etapa e
                      WHERE e.regua_id = r.id AND e.ativa) AS tem_etapa
        FROM regua r
       WHERE r.id = ${reguaId} AND r.arquivada_em IS NULL
    `;
    if (!r) throw new Error("Régua não encontrada.");
    if (!r.tem_etapa) {
      throw new Error("Esta régua não tem nenhuma etapa ativa — ela não enviaria nada.");
    }

    await marcarPadrao(tx, ctx.orgId, reguaId);
    await auditar(tx, ctx, "regua.padrao", "regua", reguaId, null);
  });
}

export async function alternarAtiva(reguaId: string, ativa: boolean): Promise<void> {
  const ctx = await exigirPapel("admin", "ativar ou pausar régua");

  await comOrg(ctx.orgId, async (tx) => {
    const [r] = await tx<{ padrao: boolean }[]>`
      UPDATE regua SET ativa = ${ativa}, atualizado_em = now()
       WHERE id = ${reguaId} AND arquivada_em IS NULL
   RETURNING padrao
    `;
    if (!r) throw new Error("Régua não encontrada.");

    await auditar(tx, ctx, ativa ? "regua.ativada" : "regua.pausada", "regua", reguaId, null);
  });
}

/**
 * Arquivar em vez de excluir: `regua_execucao.regua_id` é ON DELETE RESTRICT
 * justamente para que ninguém apague o desenho que explica cobranças passadas.
 */
export async function arquivarRegua(reguaId: string): Promise<{ canceladas: number }> {
  const ctx = await exigirPapel("admin", "arquivar régua");

  return comOrg(ctx.orgId, async (tx) => {
    const [r] = await tx<{ padrao: boolean }[]>`
      SELECT padrao FROM regua WHERE id = ${reguaId} AND arquivada_em IS NULL
    `;
    if (!r) throw new Error("Régua não encontrada.");
    if (r.padrao) {
      throw new Error(
        "Esta é a régua padrão. Escolha outra como padrão antes de arquivar esta.",
      );
    }

    await tx`
      UPDATE regua SET ativa = false, arquivada_em = now(), atualizado_em = now()
       WHERE id = ${reguaId}
    `;

    // Cobranças em andamento param aqui: quem arquivou não espera que a régua
    // continue mandando mensagem amanhã.
    const canceladas = await tx`
      UPDATE disparo d
         SET status = 'cancelado',
             motivo_ignorado = 'régua arquivada',
             processado_em = now()
        FROM regua_execucao x
       WHERE d.execucao_id = x.id
         AND x.regua_id = ${reguaId}
         AND d.status = 'agendado'
    `;
    await tx`
      UPDATE regua_execucao
         SET status = 'cancelada', motivo_parada = 'régua arquivada', encerrada_em = now()
       WHERE regua_id = ${reguaId} AND status = 'ativa'
    `;

    await auditar(tx, ctx, "regua.arquivada", "regua", reguaId, {
      disparosCancelados: canceladas.count,
    });

    return { canceladas: canceladas.count };
  });
}

/** Duplicar é como quase todo mundo cria a segunda régua. */
export async function duplicarRegua(reguaId: string): Promise<{ id: string }> {
  const ctx = await exigirPapel("admin", "duplicar régua");

  return comOrg(ctx.orgId, async (tx) => {
    const [nova] = await tx<{ id: string }[]>`
      INSERT INTO regua (org_id, nome, descricao, ativa, aplicar_a, tag,
                         pausar_ao_responder, pausar_ao_pagar, padrao)
      SELECT org_id, left(nome || ' (cópia)', 80), descricao, false, aplicar_a, tag,
             pausar_ao_responder, pausar_ao_pagar, false
        FROM regua
       WHERE id = ${reguaId} AND arquivada_em IS NULL
   RETURNING id
    `;
    if (!nova) throw new Error("Régua não encontrada.");

    // A cópia nasce pausada e sem histórico: é rascunho até alguém revisar.
    await tx`
      INSERT INTO regua_etapa (regua_id, ordem, referencia, offset_dias, hora,
                               condicao, acao, mensagem, template_id, anexar_pix, ativa)
      SELECT ${nova.id}, ordem, referencia, offset_dias, hora,
             condicao, acao, mensagem, template_id, anexar_pix, ativa
        FROM regua_etapa
       WHERE regua_id = ${reguaId} AND ativa
       ORDER BY ordem
    `;

    await auditar(tx, ctx, "regua.duplicada", "regua", nova.id, { origem: reguaId });
    return { id: nova.id };
  });
}
