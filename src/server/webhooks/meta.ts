import "server-only";

import {
  canalPorPhoneNumberId,
  processarMensagem,
  processarStatus,
  type CanalResolvido,
  type MensagemRecebida,
  type StatusRecebido,
} from "./entrada";

/**
 * Tradução do payload da Cloud API para o vocabulário do produto.
 *
 * Regras que o formato da Meta impõe e que valem lembrar:
 *
 *  - um POST traz VÁRIOS eventos (entry[].changes[].value.messages[] e
 *    .statuses[]). Falhar no meio não pode perder o resto;
 *  - o roteamento para a organização é pelo `metadata.phone_number_id` — o
 *    número de destino, não o remetente;
 *  - timestamps vêm em segundos, como string;
 *  - a Meta reenvia o mesmo evento por até 7 dias se não receber 200. Então a
 *    rota responde 200 mesmo para payload que não sabemos tratar, e o que
 *    protege contra duplicidade é a idempotência no banco, não o status HTTP.
 */

interface PayloadMeta {
  object?: string;
  entry?: EntryMeta[];
}

interface EntryMeta {
  id?: string;
  changes?: { field?: string; value?: ValorMeta }[];
}

interface ValorMeta {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: MensagemMeta[];
  statuses?: StatusMeta[];
}

interface MensagemMeta {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string; payload?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
  image?: MidiaMeta;
  audio?: MidiaMeta;
  video?: MidiaMeta;
  document?: MidiaMeta & { filename?: string };
  sticker?: MidiaMeta;
  location?: { latitude?: number; longitude?: number; name?: string };
  errors?: { code?: number; title?: string }[];
}

interface MidiaMeta {
  id?: string;
  mime_type?: string;
  caption?: string;
}

interface StatusMeta {
  id?: string;
  status?: string;
  timestamp?: string;
  recipient_id?: string;
  errors?: { code?: number; title?: string; message?: string }[];
}

export interface ResumoProcessamento {
  mensagens: number;
  statuses: number;
  ignorados: number;
}

const STATUS_META: Record<string, StatusRecebido["status"]> = {
  sent: "enviada",
  delivered: "entregue",
  read: "lida",
  failed: "falhou",
};

export async function processarWebhookMeta(
  payload: unknown,
): Promise<ResumoProcessamento> {
  const resumo: ResumoProcessamento = { mensagens: 0, statuses: 0, ignorados: 0 };
  const p = payload as PayloadMeta;

  for (const entry of p.entry ?? []) {
    for (const change of entry.changes ?? []) {
      // A assinatura do webhook pode incluir outros campos (qualidade do
      // número, template aprovado). Aqui só tratamos mensagens.
      if (change.field && change.field !== "messages") {
        resumo.ignorados++;
        continue;
      }

      const valor = change.value;
      const phoneNumberId = valor?.metadata?.phone_number_id;
      if (!valor || !phoneNumberId) {
        resumo.ignorados++;
        continue;
      }

      const canal = await canalPorPhoneNumberId(phoneNumberId);
      if (!canal) {
        // Número que não é nosso (ou canal removido). Não é erro: alguém pode
        // ter apontado o webhook do app para cá. Ignorar em silêncio.
        resumo.ignorados++;
        continue;
      }

      const nomes = mapaDeNomes(valor);

      for (const m of valor.messages ?? []) {
        const traduzida = traduzirMensagem(m, nomes);
        if (!traduzida) {
          resumo.ignorados++;
          continue;
        }
        await comIsolamento(resumo, () => processarMensagem(canal, traduzida));
        resumo.mensagens++;
      }

      for (const s of valor.statuses ?? []) {
        const traduzido = traduzirStatus(s);
        if (!traduzido) {
          resumo.ignorados++;
          continue;
        }
        await comIsolamento(resumo, () => aplicarStatus(canal, traduzido));
        resumo.statuses++;
      }
    }
  }

  return resumo;
}

async function aplicarStatus(canal: CanalResolvido, st: StatusRecebido) {
  await processarStatus(canal, st);
}

/**
 * Um evento ruim não pode derrubar o lote inteiro: se a mensagem 3 de 10 tem
 * um contato com telefone impossível, as outras 9 precisam entrar. O erro vai
 * para o log e o payload já está salvo em `evento_webhook` para reprocessar.
 */
async function comIsolamento(
  resumo: ResumoProcessamento,
  fn: () => Promise<unknown>,
): Promise<void> {
  try {
    await fn();
  } catch (erro) {
    resumo.ignorados++;
    console.error("[webhook:meta] evento falhou", erro);
  }
}

function mapaDeNomes(valor: ValorMeta): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const c of valor.contacts ?? []) {
    if (c.wa_id && c.profile?.name) mapa.set(c.wa_id, c.profile.name);
  }
  return mapa;
}

function traduzirMensagem(
  m: MensagemMeta,
  nomes: Map<string, string>,
): MensagemRecebida | null {
  if (!m.id || !m.from) return null;

  const base = {
    provedorId: m.id,
    telefone: m.from,
    nome: nomes.get(m.from) ?? null,
    em: emData(m.timestamp),
  };

  switch (m.type) {
    case "text":
      return { ...base, texto: m.text?.body ?? "" };

    // Resposta a botão de template ("Já paguei", "Falar com atendente"): é
    // texto para todo efeito — inclusive para o teste de opt-out.
    case "button":
      return { ...base, texto: m.button?.text ?? m.button?.payload ?? "" };

    case "interactive":
      return {
        ...base,
        texto:
          m.interactive?.button_reply?.title ??
          m.interactive?.list_reply?.title ??
          "",
      };

    case "image":
    case "audio":
    case "video":
    case "document":
    case "sticker": {
      const midia = m.image ?? m.audio ?? m.video ?? m.document ?? m.sticker;
      return {
        ...base,
        texto: midia?.caption ?? null,
        tipoMidia: midia?.mime_type ?? m.type,
        // A URL da Meta expira em minutos e exige token; o que faz sentido
        // guardar é o id, que o worker resolve na hora de exibir/baixar.
        midiaUrl: midia?.id ? `meta:${midia.id}` : null,
      };
    }

    case "location":
      return {
        ...base,
        texto: m.location?.name ?? "📍 localização",
        tipoMidia: "location",
      };

    default:
      // Tipos que não tratamos (reaction, order, system…) ainda contam como
      // interação: registrar a entrada reabre a janela e pausa a régua.
      return { ...base, texto: null, tipoMidia: m.type ?? "desconhecido" };
  }
}

function traduzirStatus(s: StatusMeta): StatusRecebido | null {
  if (!s.id || !s.status) return null;
  const status = STATUS_META[s.status];
  if (!status) return null;

  const erro = s.errors?.[0];
  return {
    provedorId: s.id,
    status,
    erro: erro ? `${erro.code ?? ""} ${erro.title ?? erro.message ?? ""}`.trim() : null,
    em: emData(s.timestamp),
  };
}

/** Meta manda epoch em SEGUNDOS, como string. */
function emData(ts?: string): Date | null {
  if (!ts) return null;
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000);
}
