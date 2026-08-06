import "server-only";

import { comAdmin } from "../db";
import {
  marcarEventoProcessado,
  type CanalResolvido,
} from "../webhooks/entrada";
import { processarWebhookEvolution } from "../webhooks/evolution";
import { processarWebhookMercadoPago } from "../webhooks/mercadopago";
import { processarWebhookMeta } from "../webhooks/meta";

/**
 * Rede de segurança do que entra.
 *
 * A rota do webhook responde 200 mesmo quando o processamento falha: o provedor
 * não pode ficar reentregando (a Meta desabilita o webhook depois de muita
 * falha) e o payload cru já está no banco. Quem termina o serviço é isto aqui.
 *
 * Também é o que salva um deploy no meio de um lote: o processo morre depois de
 * gravar o evento e antes de interpretar, e o evento fica com
 * `processado_em IS NULL` esperando.
 */

/** Depois disso o evento é lixo: algo no payload não vai processar nunca. */
const MAX_TENTATIVAS = 5;

/** Carência antes de reprocessar — evita correr junto com a request original. */
const MINUTOS_CARENCIA = 2;

interface EventoPendente {
  provedor: string;
  evento_id: string;
  org_id: string | null;
  payload: unknown;
}

export interface ResumoRecuperacao {
  reprocessados: number;
  ok: number;
  falhas: number;
}

/**
 * Reserva incrementando `tentativas` na mesma transação da leitura: duas
 * instâncias do worker não pegam o mesmo evento, e um evento que derruba o
 * processo consome tentativa em vez de virar loop infinito.
 */
async function reservarEventos(limite: number): Promise<EventoPendente[]> {
  return comAdmin(
    (tx) => tx<EventoPendente[]>`
      WITH candidatos AS (
        SELECT id
          FROM evento_webhook
         WHERE processado_em IS NULL
           AND tentativas < ${MAX_TENTATIVAS}
           AND recebido_em < now() - ${`${MINUTOS_CARENCIA} minutes`}::interval
         ORDER BY recebido_em
         LIMIT ${limite}
         FOR UPDATE SKIP LOCKED
      )
      UPDATE evento_webhook e
         SET tentativas = e.tentativas + 1
        FROM candidatos k
       WHERE e.id = k.id
      RETURNING e.provedor, e.evento_id, e.org_id, e.payload
    `,
  );
}

/** Evolution não tem id próprio de evento: gravamos `<canalId>:<hash>`. */
function canalDoEvento(ev: EventoPendente): CanalResolvido | null {
  const canalId = ev.evento_id.split(":")[0];
  if (!ev.org_id || !/^[0-9a-f-]{36}$/i.test(canalId)) return null;
  return { canalId, orgId: ev.org_id };
}

/** A rota grava `{ dataId, ... }` — é o id do pagamento no Mercado Pago. */
function dataIdDoEvento(ev: EventoPendente): string | null {
  const p = ev.payload as { dataId?: unknown } | null;
  return typeof p?.dataId === "string" ? p.dataId : null;
}

export async function reprocessarEventos(limite = 20): Promise<ResumoRecuperacao> {
  const pendentes = await reservarEventos(limite);
  const res: ResumoRecuperacao = {
    reprocessados: pendentes.length,
    ok: 0,
    falhas: 0,
  };

  for (const ev of pendentes) {
    try {
      if (ev.provedor === "meta") {
        await processarWebhookMeta(ev.payload);
      } else if (ev.provedor === "evolution") {
        const canal = canalDoEvento(ev);
        if (!canal) {
          // Sem canal não há como saber de quem é a mensagem. Marcar como
          // processado com erro é melhor que tentar de novo para sempre.
          await marcarEventoProcessado(ev.provedor, ev.evento_id, "canal_desconhecido");
          res.falhas++;
          continue;
        }
        await processarWebhookEvolution(canal, ev.payload);
      } else if (ev.provedor === "mercadopago") {
        const dataId = dataIdDoEvento(ev);
        if (!dataId) {
          // Payload salvo sem `data.id` não deveria acontecer (a rota exige
          // antes de gravar), mas se acontecer não há o que reprocessar.
          await marcarEventoProcessado(ev.provedor, ev.evento_id, "data_id_ausente");
          res.falhas++;
          continue;
        }
        await processarWebhookMercadoPago(dataId);
      } else {
        await marcarEventoProcessado(ev.provedor, ev.evento_id, "provedor_desconhecido");
        res.falhas++;
        continue;
      }

      await marcarEventoProcessado(ev.provedor, ev.evento_id);
      res.ok++;
    } catch (erro) {
      // `marcarEventoProcessado` com erro deixa processado_em nulo: volta para
      // a fila até estourar MAX_TENTATIVAS.
      await marcarEventoProcessado(
        ev.provedor,
        ev.evento_id,
        erro instanceof Error ? erro.message : String(erro),
      );
      res.falhas++;
    }
  }

  return res;
}

/**
 * Payload de webhook é dado de diagnóstico, não histórico: o que importa virou
 * mensagem/conversa. Guardar para sempre só engorda backup com telefone e texto
 * de cliente.
 */
export async function limparEventosAntigos(dias = 30): Promise<number> {
  const linhas = await comAdmin(
    (tx) => tx<Record<string, unknown>[]>`
      DELETE FROM evento_webhook
       WHERE recebido_em < now() - ${`${dias} days`}::interval
         AND (processado_em IS NOT NULL OR tentativas >= ${MAX_TENTATIVAS})
      RETURNING id
    `,
  );
  return linhas.length;
}

/** Sessão vencida não autentica ninguém; some com a linha e com o hash. */
export async function limparSessoesExpiradas(): Promise<number> {
  const linhas = await comAdmin(
    (tx) => tx<{ id: string }[]>`
      DELETE FROM sessao
       WHERE expira_em < now() - '7 days'::interval
      RETURNING id
    `,
  );
  return linhas.length;
}
