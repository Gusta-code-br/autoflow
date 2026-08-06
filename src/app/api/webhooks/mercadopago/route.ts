import { ErroConfigWebhook } from "@/server/webhooks/assinatura";
import { marcarEventoProcessado, registrarEvento } from "@/server/webhooks/entrada";
import {
  assinaturaValidaMercadoPago,
  processarWebhookMercadoPago,
} from "@/server/webhooks/mercadopago";

/**
 * Webhook do Mercado Pago — confirmação de pagamento da própria organização
 * (assinatura, pacote de créditos), conta `MERCADOPAGO_ACCESS_TOKEN` do AutoFlow.
 *
 * Mesmo contrato de resposta do webhook da Meta: 200 sempre que o problema é
 * nosso (o evento fica salvo e o cron de recuperação tenta de novo depois),
 * 4xx só para quem não provou ser o Mercado Pago. Retornar 5xx faria o MP
 * reentregar do mesmo jeito, então não ganha nada — só demora a resposta.
 */

// node:crypto e Postgres: nada disso roda em edge.
export const runtime = "nodejs";

const PROVEDOR = "mercadopago";

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  // Formato novo (o que configuramos no painel): `?data.id=...&type=payment`.
  // `topic`/`id` é o formato legado que o MP ainda manda para integrações
  // antigas — aceito para não depender de qual delas o painel usa.
  const tipo = url.searchParams.get("type") ?? url.searchParams.get("topic");
  const dataId = url.searchParams.get("data.id") ?? url.searchParams.get("id");

  // Outros tópicos (merchant_order, point_integration...) não fazem parte do
  // produto hoje. 200 e ignora — 4xx faria o MP insistir para sempre em algo
  // que nunca vamos tratar.
  if (tipo !== "payment" || !dataId) {
    return Response.json({ ok: true, ignorado: true });
  }

  const requestId = request.headers.get("x-request-id");
  try {
    if (!assinaturaValidaMercadoPago(request.headers.get("x-signature"), requestId, dataId)) {
      return new Response("assinatura inválida", { status: 401 });
    }
  } catch (erro) {
    return respostaDeConfig(erro);
  }

  // O corpo só serve de diagnóstico aqui: o que decide o que aplicar é a
  // consulta à API (ver `processarWebhookMercadoPago`), nunca o payload cru.
  const bruto = await request.text();
  let corpo: unknown = null;
  try {
    corpo = bruto ? JSON.parse(bruto) : null;
  } catch {
    corpo = null;
  }

  /**
   * `data.id` é o id do PAGAMENTO — se repete em várias notificações à
   * medida que o status muda (pendente → aprovado, por exemplo), então não
   * serve para deduplicar. `x-request-id` é por tentativa: reentrega do
   * MESMO aviso repete o valor, aviso novo troca.
   */
  const eventoId = requestId ?? `sem-request-id:${dataId}:${Date.now()}`;

  const novo = await registrarEvento(PROVEDOR, eventoId, tipo, { dataId, tipo, requestId, corpo });
  if (!novo) return Response.json({ ok: true, duplicado: true });

  try {
    const resumo = await processarWebhookMercadoPago(dataId);
    await marcarEventoProcessado(PROVEDOR, eventoId);
    return Response.json({ ok: true, ...resumo });
  } catch (erro) {
    // 200 de propósito: o payload está salvo e será reprocessado por nós.
    console.error("[webhook:mercadopago] falha ao processar", erro);
    await marcarEventoProcessado(PROVEDOR, eventoId, mensagemDeErro(erro));
    return Response.json({ ok: true, adiado: true });
  }
}

function respostaDeConfig(erro: unknown): Response {
  if (erro instanceof ErroConfigWebhook) {
    console.error("[webhook:mercadopago]", erro.message);
    return new Response("webhook não configurado", { status: 500 });
  }
  throw erro;
}

function mensagemDeErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}
