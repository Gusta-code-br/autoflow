import "server-only";

import { comAdmin } from "../db";
import { canalReal } from "../canais/fabrica";
import { gerarResposta, type RespostaIA } from "../ia/responder";

/**
 * Worker que consome a fila genérica `tarefa` para o tipo 'responder_ia'.
 *
 * Mesmo desenho do `disparos.ts`: reserva com FOR UPDATE SKIP LOCKED, chama a
 * IA fora da transação (rede pode levar segundos) e só grava mensagem/débito
 * depois que o envio confirma — nunca antes. Se o processo morrer entre gerar
 * o texto e enviar, a tarefa fica em 'processando' e o recuperador devolve
 * pra fila; gerar de novo é mais barato do que arriscar debitar sem enviar.
 */

const LOTE_PADRAO = 10;
const MAX_TENTATIVAS = 3;
const MINUTOS_TRAVADO = 10;

export interface ResultadoLoteIA {
  reservadas: number;
  respondidas: number;
  ignoradas: number;
  falhas: number;
}

interface TarefaIA {
  id: string;
  org_id: string;
  payload: { conversaId: string; mensagemId: string };
  tentativa: number;
}

/**
 * Reserva um lote atomicamente: marca 'processando' e devolve as linhas.
 * SKIP LOCKED faz a segunda instância pular o que a primeira já pegou.
 */
async function reservarLote(limite: number): Promise<TarefaIA[]> {
  return comAdmin(async (tx) => {
    return tx<TarefaIA[]>`
      WITH candidatos AS (
        SELECT id
          FROM tarefa
         WHERE tipo = 'responder_ia'
           AND status = 'agendado'
           AND executar_em <= now()
         ORDER BY executar_em
         LIMIT ${limite}
         FOR UPDATE SKIP LOCKED
      )
      UPDATE tarefa t
         SET status = 'processando', reservado_em = now()
        FROM candidatos k
       WHERE t.id = k.id
      RETURNING t.id, t.org_id, t.payload, t.tentativa
    `;
  });
}

async function finalizar(
  id: string,
  status: "enviado" | "ignorado" | "falhou",
  erro?: string,
): Promise<void> {
  await comAdmin(async (tx) => {
    await tx`
      UPDATE tarefa
         SET status = ${status}::status_disparo,
             ultimo_erro = ${erro ?? null}
       WHERE id = ${id}
    `;
  });
}

/** Backoff exponencial curto: 5min, 25min, 2h05 — igual ao de disparos.ts. */
async function reagendar(id: string, tentativa: number, erro: string): Promise<void> {
  const minutos = 5 * Math.pow(5, tentativa);
  await comAdmin(async (tx) => {
    await tx`
      UPDATE tarefa
         SET status = 'agendado',
             tentativa = tentativa + 1,
             ultimo_erro = ${erro},
             executar_em = now() + ${`${minutos} minutes`}::interval,
             reservado_em = NULL
       WHERE id = ${id}
    `;
  });
}

interface DestinoConversa {
  telefone: string;
  emIA: boolean;
  optOut: boolean;
}

/**
 * Segunda barreira: entre enfileirar e responder o mundo pode ter mudado —
 * um atendente pode ter assumido a conversa, ou o contato pode ter pedido
 * para não receber mais mensagens. Confere de novo, bem em cima do envio.
 */
async function destino(conversaId: string): Promise<DestinoConversa | null> {
  return comAdmin(async (tx) => {
    const [linha] = await tx<
      { telefone: string; modo: string; opt_out: boolean }[]
    >`
      SELECT ct.telefone_e164 AS telefone, c.modo, ct.opt_out
        FROM conversa c
        JOIN contato ct ON ct.id = c.contato_id
       WHERE c.id = ${conversaId}
    `;
    if (!linha) return null;
    return { telefone: linha.telefone, emIA: linha.modo === "ia", optOut: linha.opt_out };
  });
}

/**
 * Grava mensagem, uso de IA e débito — tudo junto, só depois do envio
 * confirmado. Se qualquer parte falhar, nada é gravado e a tarefa fica presa
 * em 'processando' até o recuperador.
 */
async function confirmarResposta(
  t: TarefaIA,
  resposta: RespostaIA,
  envio: { provedorId: string; conteudo: string },
): Promise<void> {
  await comAdmin(async (tx) => {
    const [msg] = await tx<{ id: string }[]>`
      INSERT INTO mensagem (org_id, conversa_id, direcao, autor, texto,
                            status, provider_id, enviada_em)
      VALUES (${t.org_id}, ${t.payload.conversaId}, 'saida', 'ia', ${envio.conteudo},
              'enviada', ${envio.provedorId}, now())
      RETURNING id
    `;

    await tx`
      INSERT INTO uso_ia (org_id, conversa_id, mensagem_id, finalidade, modelo,
                          tokens_entrada, tokens_saida, creditos)
      VALUES (${t.org_id}, ${t.payload.conversaId}, ${msg.id}, 'atendimento',
              ${resposta.modelo}, ${resposta.tokensEntrada}, ${resposta.tokensSaida}, 1)
    `;

    await tx`
      UPDATE conversa
         SET ultima_atividade_em = now()
       WHERE id = ${t.payload.conversaId}
    `;

    await tx`
      UPDATE tarefa
         SET status = 'enviado', ultimo_erro = NULL
       WHERE id = ${t.id}
    `;
  });
}

export async function processarLoteIA(limite = LOTE_PADRAO): Promise<ResultadoLoteIA> {
  const reservadas = await reservarLote(limite);
  const res: ResultadoLoteIA = {
    reservadas: reservadas.length,
    respondidas: 0,
    ignoradas: 0,
    falhas: 0,
  };

  for (const t of reservadas) {
    try {
      const resposta = await gerarResposta(t.payload.conversaId);
      if (!resposta) {
        await finalizar(t.id, "ignorado", "janela fechada ou nada a responder");
        res.ignoradas++;
        continue;
      }

      const alvo = await destino(t.payload.conversaId);
      if (!alvo || !alvo.emIA || alvo.optOut) {
        await finalizar(t.id, "ignorado", "conversa assumida por humano ou opt-out");
        res.ignoradas++;
        continue;
      }

      const envio = await canalReal().enviarTexto({
        orgId: t.org_id,
        para: alvo.telefone,
        texto: resposta.texto,
        idempotencia: `responder_ia:${t.id}`,
      });

      if (!envio.ok) {
        if (envio.retentar && t.tentativa < MAX_TENTATIVAS) {
          await reagendar(t.id, t.tentativa, envio.erro);
        } else {
          await finalizar(t.id, "falhou", envio.erro);
        }
        res.falhas++;
        continue;
      }

      await confirmarResposta(t, resposta, envio);
      res.respondidas++;
    } catch (erro) {
      const msg = erro instanceof Error ? erro.message : String(erro);
      if (t.tentativa >= MAX_TENTATIVAS) {
        await finalizar(t.id, "falhou", msg);
      } else {
        await reagendar(t.id, t.tentativa, msg);
      }
      res.falhas++;
    }
  }

  return res;
}

/**
 * Devolve à fila o que ficou preso em 'processando' — deploy no meio do
 * lote, OOM, container reciclado. Tipo-agnóstico: qualquer tarefa da fila
 * genérica usa a mesma coluna `reservado_em`.
 */
export async function recuperarTarefasTravadas(): Promise<number> {
  return comAdmin(async (tx) => {
    const linhas = await tx<{ id: string }[]>`
      UPDATE tarefa
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
