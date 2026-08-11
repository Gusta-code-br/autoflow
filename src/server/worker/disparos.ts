import "server-only";

import { comAdmin, centavos, fecharConexoes, type Transacao } from "../db";
import type { CanalWhatsApp, ResultadoEnvio } from "../canais/tipos";
import { avaliarCondicao, type Condicao, type AcaoEtapa } from "../dominio/regua";
import {
  paraTemplateMeta,
  parametrosMeta,
  preencherVariaveis,
  VariavelVaziaError,
  type ContextoMensagem,
} from "../dominio/variaveis";
import { dataLocalDe, dentroDoExpediente, diasEntre } from "../dominio/tempo";

/**
 * Worker de disparos.
 *
 * Roda fora do request: pega o que está vencido na fila, reavalia se ainda faz
 * sentido enviar e manda pelo canal. Duas instâncias podem rodar ao mesmo
 * tempo — a reserva com FOR UPDATE SKIP LOCKED garante que cada disparo sai
 * uma vez só.
 */

const LOTE_PADRAO = 25;
const MAX_TENTATIVAS = 3;
/** Reserva mais velha que isso é considerada órfã (deploy no meio do lote). */
const MINUTOS_TRAVADO = 10;

export interface DetalheDisparo {
  disparoId: string;
  resultado: "enviado" | "ignorado" | "reagendado" | "falhou" | "erro";
  motivo?: string;
}

export interface ResultadoLote {
  reservados: number;
  enviados: number;
  ignorados: number;
  falhas: number;
  detalhes: DetalheDisparo[];
}

/** Uma linha da fila com tudo que o envio precisa — sem N+1 no loop. */
interface DisparoReservado {
  id: string;
  org_id: string;
  cobranca_id: string;
  etapa_id: string;
  tentativa: number;

  // etapa
  acao: AcaoEtapa;
  condicao: Condicao;
  mensagem: string | null;
  template_id: string | null;
  anexar_pix: boolean;

  // cobrança + contato
  cobranca_status: string;
  descricao: string;
  valor: bigint;
  vencimento: string;
  contato_id: string;
  contato_nome: string;
  telefone_e164: string;
  bloqueado: boolean;
  opt_out_em: Date | null;

  // organização
  nome_empresa: string;
  nome_atendente: string;
  chave_pix: string | null;
  fuso: string;
  horario_inicio: string;
  horario_fim: string;
  dias_semana: number[];

  // régua
  pausar_ao_responder: boolean;

  // derivados
  canal_id: string | null;
  janela_expira_em: Date | null;
  respondeu: boolean;
  link_pagamento: string | null;
}

/**
 * Reserva um lote atomicamente: marca 'processando' e devolve as linhas já
 * enriquecidas. SKIP LOCKED faz a segunda instância pular o que a primeira
 * pegou em vez de ficar esperando o lock.
 */
async function reservarLote(limite: number): Promise<DisparoReservado[]> {
  return comAdmin(async (tx) => {
    return tx<DisparoReservado[]>`
      WITH candidatos AS (
        SELECT d.id
          FROM disparo d
          JOIN regua_execucao ex ON ex.id = d.execucao_id
          JOIN organizacao o     ON o.id = d.org_id
         WHERE d.status = 'agendado'
           AND d.executar_em <= now()
           AND ex.status = 'ativa'
         ORDER BY d.executar_em
         LIMIT ${limite}
         FOR UPDATE OF d SKIP LOCKED
      )
      UPDATE disparo d
         SET status = 'processando', reservado_em = now()
        FROM candidatos k
        JOIN disparo dd       ON dd.id = k.id
        JOIN regua_etapa e    ON e.id = dd.etapa_id
        JOIN regua r          ON r.id = e.regua_id
        JOIN cobranca c       ON c.id = dd.cobranca_id
        JOIN contato ct       ON ct.id = c.contato_id
        JOIN organizacao o    ON o.id = dd.org_id
       WHERE d.id = k.id
      RETURNING
        d.id, d.org_id, d.cobranca_id, d.etapa_id, d.tentativa,
        e.acao, e.condicao, e.mensagem, e.template_id, e.anexar_pix,
        c.status AS cobranca_status, c.descricao, c.valor,
        c.vencimento::text AS vencimento,
        c.contato_id,
        ct.nome AS contato_nome, ct.telefone_e164, ct.bloqueado, ct.opt_out_em,
        o.nome_empresa, o.nome_atendente, o.chave_pix, o.fuso,
        o.horario_inicio, o.horario_fim, o.dias_semana,
        r.pausar_ao_responder,

        -- canal principal conectado da organização
        (SELECT ca.id FROM canal_whatsapp ca
          WHERE ca.org_id = d.org_id AND ca.status = 'conectado'
          ORDER BY ca.principal DESC, ca.criado_em
          LIMIT 1) AS canal_id,

        -- janela de 24h da Meta: se aberta, pode mandar texto livre
        (SELECT cv.janela_expira_em FROM conversa cv
          WHERE cv.org_id = d.org_id AND cv.contato_id = c.contato_id
          ORDER BY cv.ultima_atividade_em DESC
          LIMIT 1) AS janela_expira_em,

        -- respondeu depois do último envio desta cobrança?
        EXISTS (
          SELECT 1 FROM mensagem m
            JOIN conversa cv ON cv.id = m.conversa_id
           WHERE m.org_id = d.org_id
             AND cv.contato_id = c.contato_id
             AND m.direcao = 'entrada'
             AND m.criado_em > COALESCE(c.ultimo_envio_em, c.criado_em)
        ) AS respondeu,

        (SELECT COALESCE(p.pix_copia_cola, p.ticket_url) FROM pagamento p
          WHERE p.cobranca_id = c.id AND p.status = 'pendente'
          ORDER BY p.criado_em DESC
          LIMIT 1) AS link_pagamento
    `;
  });
}

async function finalizar(
  id: string,
  status: "enviado" | "ignorado" | "falhou",
  extra: { motivo?: string; erro?: string } = {},
) {
  await comAdmin(async (tx) => {
    await tx`
      UPDATE disparo
         SET status = ${status}::status_disparo,
             motivo_ignorado = ${extra.motivo ?? null},
             ultimo_erro = ${extra.erro ?? null},
             processado_em = now()
       WHERE id = ${id}
    `;
  });
}

/** Backoff exponencial curto: 5min, 25min, 2h05. */
async function reagendar(id: string, tentativa: number, erro: string) {
  const minutos = 5 * Math.pow(5, tentativa);
  await comAdmin(async (tx) => {
    await tx`
      UPDATE disparo
         SET status = 'agendado',
             tentativa = tentativa + 1,
             ultimo_erro = ${erro},
             reservado_em = NULL,
             executar_em = now() + ${`${minutos} minutes`}::interval
       WHERE id = ${id}
    `;
  });
}

/** Empurra para o próximo horário útil sem gastar tentativa. */
async function adiarParaExpediente(id: string, quando: Date) {
  await comAdmin(async (tx) => {
    await tx`
      UPDATE disparo
         SET status = 'agendado', reservado_em = NULL, executar_em = ${quando}
       WHERE id = ${id}
    `;
  });
}

function contextoDaCobranca(d: DisparoReservado): ContextoMensagem {
  const hoje = dataLocalDe(new Date(), d.fuso);
  return {
    nomeCompleto: d.contato_nome,
    valorCentavos: centavos(d.valor),
    vencimento: d.vencimento,
    descricao: d.descricao,
    diasAtraso: Math.max(0, diasEntre(d.vencimento, hoje)),
    empresa: d.nome_empresa,
    atendente: d.nome_atendente,
    linkPagamento: d.anexar_pix ? (d.link_pagamento ?? d.chave_pix) : null,
  };
}

export async function processarLote(
  canal: CanalWhatsApp,
  limite = LOTE_PADRAO,
): Promise<ResultadoLote> {
  const reservados = await reservarLote(limite);
  const res: ResultadoLote = {
    reservados: reservados.length,
    enviados: 0,
    ignorados: 0,
    falhas: 0,
    detalhes: [],
  };

  const agora = new Date();

  for (const d of reservados) {
    const ignorar = async (motivo: string) => {
      await finalizar(d.id, "ignorado", { motivo });
      res.ignorados++;
      res.detalhes.push({ disparoId: d.id, resultado: "ignorado", motivo });
    };

    try {
      // 1. Segunda barreira: entre agendar e disparar o mundo mudou?
      const veredito = avaliarCondicao(d.condicao, {
        pago: d.cobranca_status === "pago",
        cancelada: d.cobranca_status === "cancelado",
        respondeu: d.pausar_ao_responder && d.respondeu,
        optOut: d.bloqueado || d.opt_out_em !== null,
      });
      if (!veredito.enviar) {
        await ignorar(veredito.motivo);
        continue;
      }

      // 2. Ações que não são mensagem só viram evento no histórico.
      if (d.acao !== "enviar_whatsapp") {
        await registrarAcaoInterna(d);
        res.enviados++;
        res.detalhes.push({ disparoId: d.id, resultado: "enviado", motivo: d.acao });
        continue;
      }

      // 3. Nunca de madrugada nem no domingo: adia sem gastar tentativa.
      const util = dentroDoExpediente(agora, {
        fuso: d.fuso,
        horarioInicio: d.horario_inicio.slice(0, 5),
        horarioFim: d.horario_fim.slice(0, 5),
        diasSemana: d.dias_semana,
      });
      if (util.getTime() > agora.getTime()) {
        await adiarParaExpediente(d.id, util);
        res.detalhes.push({
          disparoId: d.id,
          resultado: "reagendado",
          motivo: "fora_do_expediente",
        });
        continue;
      }

      if (!d.canal_id) {
        await ignorar("sem_canal_conectado");
        continue;
      }

      const contexto = contextoDaCobranca(d);
      const janelaAberta =
        d.janela_expira_em !== null && d.janela_expira_em.getTime() > agora.getTime();

      let envio: ResultadoEnvio;

      if (janelaAberta && d.mensagem) {
        // Dentro das 24h a Meta aceita texto livre.
        envio = await canal.enviarTexto({
          orgId: d.org_id,
          para: d.telefone_e164,
          texto: preencherVariaveis(d.mensagem, contexto),
          idempotencia: d.id,
        });
      } else if (d.template_id) {
        const { ordem } = paraTemplateMeta(d.mensagem ?? "");
        envio = await canal.enviarTemplate({
          orgId: d.org_id,
          para: d.telefone_e164,
          templateId: d.template_id,
          parametros: parametrosMeta(ordem, contexto),
          idempotencia: d.id,
        });
      } else {
        // Fora da janela e sem template aprovado: a Meta recusaria.
        await ignorar("fora_da_janela_sem_template");
        continue;
      }

      if (!envio.ok) {
        if (envio.retentar && d.tentativa < MAX_TENTATIVAS) {
          await reagendar(d.id, d.tentativa, envio.erro);
          res.falhas++;
          res.detalhes.push({
            disparoId: d.id,
            resultado: "reagendado",
            motivo: envio.erro,
          });
        } else {
          await finalizar(d.id, "falhou", { erro: envio.erro });
          res.falhas++;
          res.detalhes.push({
            disparoId: d.id,
            resultado: "falhou",
            motivo: envio.erro,
          });
        }
        continue;
      }

      await confirmarEnvio(d, envio);
      res.enviados++;
      res.detalhes.push({ disparoId: d.id, resultado: "enviado" });
    } catch (erro) {
      const msg =
        erro instanceof VariavelVaziaError
          ? `mensagem com variável sem valor: ${erro.variaveis.join(", ")}`
          : erro instanceof Error
            ? erro.message
            : String(erro);

      // Erro de dado (variável vazia) não adianta repetir: falha direto.
      if (erro instanceof VariavelVaziaError || d.tentativa >= MAX_TENTATIVAS) {
        await finalizar(d.id, "falhou", { erro: msg });
      } else {
        await reagendar(d.id, d.tentativa, msg);
      }
      res.falhas++;
      res.detalhes.push({ disparoId: d.id, resultado: "erro", motivo: msg });
    }
  }

  return res;
}

/**
 * Grava mensagem, debita crédito e fecha o disparo — tudo junto. Se qualquer
 * parte falhar, nada é gravado e o disparo fica em 'processando' até o
 * recuperador; melhor reprocessar do que debitar sem enviar (ou vice-versa).
 */
async function confirmarEnvio(
  d: DisparoReservado,
  envio: Extract<ResultadoEnvio, { ok: true }>,
) {
  await comAdmin(async (tx) => {
    const conversaId = await conversaDoContato(tx, d);

    const [msg] = await tx<{ id: string }[]>`
      INSERT INTO mensagem (org_id, conversa_id, direcao, autor, texto,
                            template_id, status, provider_id, enviada_em)
      VALUES (${d.org_id}, ${conversaId}, 'saida', 'sistema', ${envio.conteudo},
              ${d.template_id}, 'enviada', ${envio.provedorId}, now())
      RETURNING id
    `;

    await tx`
      UPDATE disparo
         SET status = 'enviado', mensagem_id = ${msg.id}, processado_em = now()
       WHERE id = ${d.id}
    `;

    await tx`
      UPDATE cobranca
         SET tentativas = tentativas + 1, ultimo_envio_em = now(),
             atualizado_em = now()
       WHERE id = ${d.cobranca_id}
    `;

    await tx`
      INSERT INTO cobranca_evento (org_id, cobranca_id, tipo, descricao, dados)
      VALUES (${d.org_id}, ${d.cobranca_id}, 'enviada',
              'Mensagem automática enviada',
              ${tx.json({ etapaId: d.etapa_id, disparoId: d.id })})
    `;
  });
}

/** Conversa é por (org, contato, canal): reaproveita a existente ou cria. */
async function conversaDoContato(
  tx: Transacao,
  d: DisparoReservado,
): Promise<string> {
  const [linha] = await tx<{ id: string }[]>`
    INSERT INTO conversa (org_id, contato_id, canal_id, intencao,
                          ultima_atividade_em)
    VALUES (${d.org_id}, ${d.contato_id}, ${d.canal_id}, 'cobranca', now())
    ON CONFLICT (org_id, contato_id, canal_id) DO UPDATE
       SET ultima_atividade_em = now()
    RETURNING id
  `;
  return linha.id;
}

async function registrarAcaoInterna(d: DisparoReservado) {
  await comAdmin(async (tx) => {
    await tx`
      INSERT INTO cobranca_evento (org_id, cobranca_id, tipo, descricao, dados)
      VALUES (${d.org_id}, ${d.cobranca_id}, ${d.acao},
              'Ação interna da régua', ${tx.json({ etapaId: d.etapa_id })})
    `;
    if (d.acao === "marcar_perdido") {
      await tx`
        UPDATE cobranca SET status = 'cancelado', atualizado_em = now()
         WHERE id = ${d.cobranca_id} AND status <> 'pago'
      `;
    }
    await tx`
      UPDATE disparo SET status = 'enviado', processado_em = now()
       WHERE id = ${d.id}
    `;
  });
}

/**
 * Devolve à fila o que ficou preso em 'processando' — deploy no meio do lote,
 * OOM, container reciclado. Roda antes de cada lote.
 */
export async function recuperarTravados(): Promise<number> {
  return comAdmin(async (tx) => {
    const linhas = await tx<{ id: string }[]>`
      UPDATE disparo
         SET status = CASE WHEN tentativa >= ${MAX_TENTATIVAS}
                           THEN 'falhou'::status_disparo
                           ELSE 'agendado'::status_disparo END,
             ultimo_erro = 'worker interrompido durante o processamento',
             reservado_em = NULL
       WHERE status = 'processando'
         AND reservado_em < now() - ${`${MINUTOS_TRAVADO} minutes`}::interval
      RETURNING id
    `;
    return linhas.length;
  });
}

export async function rodarCiclo(canal: CanalWhatsApp): Promise<ResultadoLote> {
  await recuperarTravados();
  return processarLote(canal);
}

export async function encerrar(): Promise<void> {
  await fecharConexoes();
}
