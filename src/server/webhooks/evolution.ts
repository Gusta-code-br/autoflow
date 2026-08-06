import "server-only";

import {
  processarMensagem,
  processarStatus,
  type CanalResolvido,
  type MensagemRecebida,
  type StatusRecebido,
} from "./entrada";
import type { ResumoProcessamento } from "./meta";

/**
 * Webhook da Evolution (WhatsApp não-oficial, via Baileys).
 *
 * Diferenças que mudam o código, não só o parser:
 *
 *  - o payload traz UM evento por POST (a Meta traz um lote);
 *  - o remetente vem como JID (`5511999999999@s.whatsapp.net`), e grupo vem
 *    como `...@g.us` — grupo nunca vira contato de cobrança;
 *  - `fromMe: true` é eco do que nós mesmos mandamos (ou do celular do dono):
 *    tratar como entrada faria a régua se pausar sozinha;
 *  - não existe id de evento próprio, então a idempotência sai do `key.id`
 *    da mensagem, que é o mesmo identificador usado no envio.
 */

interface PayloadEvolution {
  event?: string;
  instance?: string;
  data?: DadosEvolution | DadosEvolution[];
}

interface DadosEvolution {
  key?: { id?: string; remoteJid?: string; fromMe?: boolean };
  keyId?: string;
  remoteJid?: string;
  pushName?: string;
  status?: string;
  messageType?: string;
  messageTimestamp?: number | string;
  message?: MensagemEvolution;
}

interface MensagemEvolution {
  conversation?: string;
  extendedTextMessage?: { text?: string };
  imageMessage?: { caption?: string; mimetype?: string };
  videoMessage?: { caption?: string; mimetype?: string };
  audioMessage?: { mimetype?: string };
  documentMessage?: { fileName?: string; mimetype?: string };
  stickerMessage?: { mimetype?: string };
  buttonsResponseMessage?: { selectedDisplayText?: string };
  listResponseMessage?: { title?: string };
  locationMessage?: { name?: string };
}

/** Nomes de status do Baileys → nosso enum. */
const STATUS_EVOLUTION: Record<string, StatusRecebido["status"]> = {
  PENDING: "enviada",
  SERVER_ACK: "enviada",
  DELIVERY_ACK: "entregue",
  READ: "lida",
  PLAYED: "lida",
  ERROR: "falhou",
};

export async function processarWebhookEvolution(
  canal: CanalResolvido,
  payload: unknown,
): Promise<ResumoProcessamento> {
  const resumo: ResumoProcessamento = { mensagens: 0, statuses: 0, ignorados: 0 };
  const p = payload as PayloadEvolution;
  const eventos = Array.isArray(p.data) ? p.data : p.data ? [p.data] : [];

  for (const d of eventos) {
    try {
      if (p.event === "messages.upsert") {
        const msg = traduzirMensagem(d);
        if (!msg) {
          resumo.ignorados++;
          continue;
        }
        await processarMensagem(canal, msg);
        resumo.mensagens++;
      } else if (p.event === "messages.update" || p.event === "send.message") {
        const st = traduzirStatus(d);
        if (!st) {
          resumo.ignorados++;
          continue;
        }
        await processarStatus(canal, st);
        resumo.statuses++;
      } else {
        // connection.update, qrcode.updated, contacts.upsert… não mexem em
        // conversa. O canal em si é atualizado por outro caminho.
        resumo.ignorados++;
      }
    } catch (erro) {
      resumo.ignorados++;
      console.error("[webhook:evolution] evento falhou", erro);
    }
  }

  return resumo;
}

function traduzirMensagem(d: DadosEvolution): MensagemRecebida | null {
  const id = d.key?.id ?? d.keyId;
  const jid = d.key?.remoteJid ?? d.remoteJid;
  if (!id || !jid) return null;

  // Eco do próprio envio: já temos essa mensagem como 'saida'.
  if (d.key?.fromMe) return null;
  // Grupo e status/broadcast não são cobrança de ninguém.
  if (!jid.endsWith("@s.whatsapp.net") && !jid.endsWith("@c.us")) return null;

  const telefone = jid.split("@")[0]?.split(":")[0];
  if (!telefone) return null;

  const { texto, tipoMidia } = conteudo(d.message);

  return {
    provedorId: id,
    telefone,
    nome: d.pushName ?? null,
    texto,
    tipoMidia,
    em: emData(d.messageTimestamp),
  };
}

function conteudo(m?: MensagemEvolution): {
  texto: string | null;
  tipoMidia: string | null;
} {
  if (!m) return { texto: null, tipoMidia: null };

  if (m.conversation) return { texto: m.conversation, tipoMidia: null };
  if (m.extendedTextMessage?.text) {
    return { texto: m.extendedTextMessage.text, tipoMidia: null };
  }
  if (m.buttonsResponseMessage?.selectedDisplayText) {
    return { texto: m.buttonsResponseMessage.selectedDisplayText, tipoMidia: null };
  }
  if (m.listResponseMessage?.title) {
    return { texto: m.listResponseMessage.title, tipoMidia: null };
  }
  if (m.imageMessage) {
    return {
      texto: m.imageMessage.caption ?? null,
      tipoMidia: m.imageMessage.mimetype ?? "image",
    };
  }
  if (m.videoMessage) {
    return {
      texto: m.videoMessage.caption ?? null,
      tipoMidia: m.videoMessage.mimetype ?? "video",
    };
  }
  if (m.audioMessage) {
    return { texto: null, tipoMidia: m.audioMessage.mimetype ?? "audio" };
  }
  if (m.documentMessage) {
    return {
      texto: m.documentMessage.fileName ?? null,
      tipoMidia: m.documentMessage.mimetype ?? "document",
    };
  }
  if (m.stickerMessage) return { texto: null, tipoMidia: "sticker" };
  if (m.locationMessage) {
    return { texto: m.locationMessage.name ?? "📍 localização", tipoMidia: "location" };
  }

  return { texto: null, tipoMidia: "desconhecido" };
}

function traduzirStatus(d: DadosEvolution): StatusRecebido | null {
  const id = d.key?.id ?? d.keyId;
  if (!id || !d.status) return null;

  const status = STATUS_EVOLUTION[d.status.toUpperCase()];
  if (!status) return null;

  return { provedorId: id, status, em: emData(d.messageTimestamp) };
}

/** Baileys manda epoch em segundos (às vezes como string). */
function emData(ts?: number | string): Date | null {
  if (ts === undefined || ts === null) return null;
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000);
}
