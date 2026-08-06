import { createHash } from "node:crypto";

import { hashToken } from "@/server/seguranca/cripto";
import {
  canalPorTokenWebhook,
  marcarEventoProcessado,
  registrarEvento,
} from "@/server/webhooks/entrada";
import { processarWebhookEvolution } from "@/server/webhooks/evolution";

/**
 * Webhook da Evolution (WhatsApp não-oficial).
 *
 * Sem HMAC — o provedor não assina. O que temos é uma URL por canal com
 * segredo próprio: `/api/webhooks/evolution/<canalId>?t=<token>`. Guardamos só
 * o HMAC do token, e o canal só é aceito se id e token estiverem na mesma
 * linha. Vazou a URL de um cliente, revoga a daquele canal e ninguém mais é
 * afetado.
 *
 * Vale ser explícito sobre o limite: quem tiver a URL consegue injetar
 * "mensagem recebida" naquela organização. É o teto do que dá para fazer com
 * um provedor que não assina — mais um motivo para a Cloud API ser o caminho
 * recomendado no produto.
 */

export const runtime = "nodejs";

const PROVEDOR = "evolution";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ canalId: string }> },
): Promise<Response> {
  const { canalId } = await ctx.params;

  const token =
    new URL(request.url).searchParams.get("t") ??
    request.headers.get("x-webhook-token");
  if (!token) return new Response("sem token", { status: 401 });

  const canal = await canalPorTokenWebhook(canalId, hashToken(token));
  if (!canal) return new Response("canal não autorizado", { status: 401 });

  const bruto = await request.text();
  let payload: unknown;
  try {
    payload = JSON.parse(bruto);
  } catch {
    return new Response("payload inválido", { status: 400 });
  }

  // A Evolution não manda id de entrega. Hash do corpo + canal: reentrega
  // idêntica não repete efeito, e dois canais podem receber o mesmo payload
  // sem um bloquear o outro.
  const eventoId = `${canalId}:${createHash("sha256").update(bruto).digest("hex")}`;
  const tipo = (payload as { event?: string })?.event ?? null;

  const novo = await registrarEvento(PROVEDOR, eventoId, tipo, payload, canal.orgId);
  if (!novo) return Response.json({ ok: true, duplicado: true });

  try {
    const resumo = await processarWebhookEvolution(canal, payload);
    await marcarEventoProcessado(PROVEDOR, eventoId);
    return Response.json({ ok: true, ...resumo });
  } catch (erro) {
    console.error("[webhook:evolution] falha ao processar", erro);
    await marcarEventoProcessado(
      PROVEDOR,
      eventoId,
      erro instanceof Error ? erro.message : String(erro),
    );
    return Response.json({ ok: true, adiado: true });
  }
}
