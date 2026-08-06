import "server-only";

/**
 * WhatsApp Embedded Signup (Login com Facebook para Empresas).
 *
 * O fluxo manual (colar token + Phone Number ID) pede que o cliente entre no
 * Business Manager, ache o System User, gere um token permanente — três
 * passos que exigem alguém técnico do outro lado. O Embedded Signup troca
 * isso por um pop-up: o cliente loga com a conta do WhatsApp Business dele e
 * a Meta devolve um `code` de autorização. Este módulo faz o resto no
 * servidor:
 *
 *   1. troca o `code` por um token de acesso (ligado ao usuário de sistema da
 *      Configuração, não expira como um token de usuário comum);
 *   2. assina o app nos webhooks da WABA — sem isso a Meta aceita mensagens
 *      mas nunca avisa a gente que elas chegaram;
 *   3. registra o número na Cloud API com um PIN de verificação em duas
 *      etapas — todo número novo (ou migrado de outro BSP) chega "não
 *      registrado" e recusa envio até este passo.
 *
 * Só HTTP: não abre transação, não lê contexto de tenant. Quem chama decide o
 * que fazer com o token (a DAL de conexões, que grava via `fabrica.ts`).
 */

const VERSAO_API = process.env.META_API_VERSION ?? "v21.0";
const BASE = process.env.META_API_BASE ?? "https://graph.facebook.com";
const TIMEOUT_MS = 15_000;

export class ErroEmbeddedSignup extends Error {
  constructor(
    message: string,
    readonly codigo?: string,
  ) {
    super(message);
    this.name = "ErroEmbeddedSignup";
  }
}

interface RespostaErroMeta {
  error?: { message?: string; type?: string; code?: number };
}

function credenciaisApp(): { appId: string; appSecret: string } {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    throw new ErroEmbeddedSignup(
      "Conexão automática não configurada nesta instância (faltam META_APP_ID/META_APP_SECRET).",
      "config",
    );
  }
  return { appId, appSecret };
}

async function postar(caminho: string, token: string, corpo?: unknown): Promise<Response> {
  try {
    return await fetch(`${BASE}/${VERSAO_API}/${caminho}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(corpo ?? {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new ErroEmbeddedSignup(
      "Não foi possível falar com a Meta agora. Tente de novo em instantes.",
      "rede",
    );
  }
}

async function exigirOk(resp: Response, mensagemPadrao: string, codigo: string): Promise<void> {
  if (resp.ok) return;
  const json = (await resp.json().catch(() => ({}))) as RespostaErroMeta;
  throw new ErroEmbeddedSignup(json.error?.message ?? mensagemPadrao, codigo);
}

/**
 * Troca o `code` devolvido pelo Facebook Login (Embedded Signup) por um token
 * de acesso.
 *
 * Diferente de um login comum, esse `code` já nasce vinculado à Configuração
 * de Embedded Signup do app — a troca não pede `redirect_uri` (o SDK do
 * cliente não usa redirecionamento, é tudo em pop-up) nem devolve um token de
 * curta duração: é o token de longo prazo que o worker vai usar dali pra
 * frente, até o cliente desconectar ou revogar o acesso pela Meta.
 */
export async function trocarCodePorToken(code: string): Promise<string> {
  const { appId, appSecret } = credenciaisApp();

  const url = new URL(`${BASE}/${VERSAO_API}/oauth/access_token`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("code", code);

  let resp: Response;
  try {
    resp = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch {
    throw new ErroEmbeddedSignup(
      "Não foi possível falar com a Meta agora. Tente de novo em instantes.",
      "rede",
    );
  }

  const json = (await resp.json().catch(() => ({}))) as RespostaErroMeta & {
    access_token?: string;
  };

  if (!resp.ok || !json.access_token) {
    throw new ErroEmbeddedSignup(
      json.error?.message ??
        "Código de autorização inválido ou expirado. Volte e tente conectar de novo.",
      "code",
    );
  }

  return json.access_token;
}

/**
 * Assina o app nos webhooks da WABA (WhatsApp Business Account).
 *
 * O Embedded Signup cria a ligação entre o número e o app, mas não liga o
 * hub de webhook sozinho — sem esta chamada a Meta recebe as respostas do
 * cliente e não avisa ninguém: `POST /api/webhooks/whatsapp` nunca dispara.
 */
export async function assinarWebhookWaba(token: string, wabaId: string): Promise<void> {
  const resp = await postar(`${wabaId}/subscribed_apps`, token);
  await exigirOk(resp, "Não foi possível assinar os webhooks desta conta.", "webhook");
}

/**
 * Registra o número na Cloud API com um PIN de verificação em duas etapas.
 *
 * Todo número novo (ou migrado de outro BSP) chega "não registrado" — a Meta
 * aceita a credencial mas recusa envio até este passo rodar uma vez.
 */
export async function registrarNumero(
  token: string,
  phoneNumberId: string,
  pin: string,
): Promise<void> {
  const resp = await postar(`${phoneNumberId}/register`, token, {
    messaging_product: "whatsapp",
    pin,
  });
  await exigirOk(resp, "Não foi possível registrar o número na Cloud API.", "registro");
}

/** PIN de 6 dígitos para o registro acima. A Meta aceita qualquer valor nessa faixa. */
export function gerarPin(): string {
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
}
