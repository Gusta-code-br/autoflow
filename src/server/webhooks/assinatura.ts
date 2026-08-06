import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verificação de quem está batendo no webhook.
 *
 * A rota de webhook é o único endpoint do produto que aceita POST sem sessão:
 * a Meta não faz login, ela assina. Sem essa verificação, qualquer um na
 * internet manda "cliente respondeu" e faz a régua parar de cobrar — ou pior,
 * injeta mensagem de entrada em nome de um contato de outra organização.
 *
 * Duas coisas diferentes, com nomes parecidos, que a Meta usa:
 *
 *   verify_token  — string que EU escolho e repito no painel da Meta. Só é
 *                   usada no GET de verificação da assinatura do webhook.
 *   app_secret    — segredo do app. A Meta assina o corpo cru do POST com ele
 *                   (HMAC-SHA256) e manda em `X-Hub-Signature-256`.
 */

/** Assinatura calculada sobre o corpo CRU — reserializar muda os bytes. */
export function assinaturaValidaMeta(
  corpoBruto: string,
  cabecalho: string | null | undefined,
): boolean {
  const segredo = process.env.META_APP_SECRET;
  if (!segredo) {
    // Falhar fechado: sem segredo configurado ninguém entra. O contrário
    // (aceitar tudo em dev) é como esses endpoints vazam para produção.
    throw new ErroConfigWebhook("META_APP_SECRET não configurado");
  }
  if (!cabecalho?.startsWith("sha256=")) return false;

  const recebida = Buffer.from(cabecalho.slice("sha256=".length), "hex");
  const esperada = createHmac("sha256", segredo).update(corpoBruto, "utf8").digest();

  // Buffer.from(hex) ignora caracteres inválidos em silêncio: um header
  // "sha256=zz" viraria buffer vazio. O check de tamanho barra isso antes.
  if (recebida.length !== esperada.length) return false;
  return timingSafeEqual(recebida, esperada);
}

/** GET de verificação: a Meta devolve o desafio se o token bater. */
export function desafioDaMeta(url: URL): string | null {
  const esperado = process.env.META_VERIFY_TOKEN;
  if (!esperado) throw new ErroConfigWebhook("META_VERIFY_TOKEN não configurado");

  const modo = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const desafio = url.searchParams.get("hub.challenge");

  if (modo !== "subscribe" || !token || !desafio) return null;
  return comparar(token, esperado) ? desafio : null;
}

/**
 * Evolution não assina nada: a autenticação dele é o segredo da própria URL
 * (`/api/webhooks/evolution/<canalId>?t=<token>`), conferido contra o hash
 * guardado — ver `canalPorTokenWebhook`. Fica aqui a nota de por que é assim:
 * é mais fraco que HMAC (o segredo viaja na URL e aparece em log de proxy),
 * mas é o teto do que o provedor não-oficial oferece; por isso o token é por
 * canal — vazou um, revoga um.
 */

function comparar(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Erro de configuração ≠ requisição inválida: um é 500 nosso, outro é 401. */
export class ErroConfigWebhook extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ErroConfigWebhook";
  }
}
