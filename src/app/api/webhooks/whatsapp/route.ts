import { createHash } from "node:crypto";

import {
  assinaturaValidaMeta,
  desafioDaMeta,
  ErroConfigWebhook,
} from "@/server/webhooks/assinatura";
import {
  marcarEventoProcessado,
  registrarEvento,
} from "@/server/webhooks/entrada";
import { processarWebhookMeta } from "@/server/webhooks/meta";

/**
 * Webhook da WhatsApp Cloud API.
 *
 * Único endpoint do produto que aceita POST sem sessão — e por isso o único
 * cuja porta de entrada é criptográfica: HMAC do corpo cru com o app_secret.
 *
 * Contrato da Meta que dita o formato das respostas aqui:
 *  - qualquer coisa diferente de 2xx faz a Meta reenviar por até 7 dias e, se
 *    persistir, desabilitar a assinatura do webhook. Então erro NOSSO não pode
 *    virar 5xx: o evento fica salvo com `erro` e o cron de recuperação
 *    reprocessa. 4xx fica só para quem não provou ser a Meta;
 *  - a resposta precisa sair rápido. O trabalho pesado real (IA respondendo)
 *    não acontece aqui: vira linha em `tarefa`.
 */

// node:crypto e Postgres: nada disso roda em edge.
export const runtime = "nodejs";

const PROVEDOR = "meta";

/** Verificação da assinatura do webhook no painel da Meta. */
export async function GET(request: Request): Promise<Response> {
  try {
    const desafio = desafioDaMeta(new URL(request.url));
    if (!desafio) return new Response("forbidden", { status: 403 });
    // A Meta exige o challenge cru, como text/plain.
    return new Response(desafio, {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  } catch (erro) {
    return respostaDeConfig(erro);
  }
}

export async function POST(request: Request): Promise<Response> {
  // Precisa ser o corpo CRU: reserializar o JSON muda bytes (ordem de chaves,
  // escape de unicode) e a assinatura deixa de bater.
  const bruto = await request.text();

  try {
    if (!assinaturaValidaMeta(bruto, request.headers.get("x-hub-signature-256"))) {
      return new Response("assinatura inválida", { status: 401 });
    }
  } catch (erro) {
    return respostaDeConfig(erro);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(bruto);
  } catch {
    // Assinou corretamente mas mandou lixo: não é a Meta se comportando.
    return new Response("payload inválido", { status: 400 });
  }

  /**
   * A Meta não manda um id de evento para o lote. O hash do corpo cru serve:
   * a reentrega do MESMO lote é byte a byte idêntica. Lotes diferentes que
   * repetem uma mensagem são pegos pela UNIQUE (org_id, provider_id) lá
   * dentro — duas camadas, porque uma cobrança enviada duas vezes é o tipo de
   * bug que o cliente do nosso cliente percebe antes da gente.
   */
  const eventoId = createHash("sha256").update(bruto).digest("hex");

  const novo = await registrarEvento(PROVEDOR, eventoId, tipoDoPayload(payload), payload);
  if (!novo) return Response.json({ ok: true, duplicado: true });

  try {
    const resumo = await processarWebhookMeta(payload);
    await marcarEventoProcessado(PROVEDOR, eventoId);
    return Response.json({ ok: true, ...resumo });
  } catch (erro) {
    // 200 de propósito: o payload está salvo e será reprocessado por nós. Se
    // devolvêssemos 500, a Meta reenviaria e ainda assim cairia no dedup.
    console.error("[webhook:whatsapp] falha ao processar", erro);
    await marcarEventoProcessado(PROVEDOR, eventoId, mensagemDeErro(erro));
    return Response.json({ ok: true, adiado: true });
  }
}

function tipoDoPayload(payload: unknown): string | null {
  const p = payload as { entry?: { changes?: { field?: string }[] }[] };
  return p?.entry?.[0]?.changes?.[0]?.field ?? null;
}

function respostaDeConfig(erro: unknown): Response {
  if (erro instanceof ErroConfigWebhook) {
    console.error("[webhook:whatsapp]", erro.message);
    return new Response("webhook não configurado", { status: 500 });
  }
  throw erro;
}

function mensagemDeErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}
