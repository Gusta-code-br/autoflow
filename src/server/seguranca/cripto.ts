import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Cifra simétrica para segredos de terceiros que precisam voltar em claro:
 * access token do Mercado Pago, token permanente da Meta Cloud API, apikey da
 * Evolution. Diferente de senha, aqui NÃO dá para usar hash — a gente precisa
 * do valor original para chamar a API do provedor.
 *
 * AES-256-GCM: cifra + autentica. Se alguém adulterar um byte no banco, o
 * decifrar falha em vez de devolver lixo silenciosamente.
 *
 * Formato guardado (coluna `*_cif`, text):
 *   v<versão>.<iv base64url>.<tag base64url>.<cifrado base64url>
 *
 * A versão da chave também vai na coluna `chave_versao` de cada tabela, o que
 * permite achar por SQL tudo que ainda usa a chave antiga durante uma rotação
 * ("SELECT ... WHERE chave_versao = 1"). O prefixo no texto é redundante de
 * propósito: se alguém copiar o valor para outra tabela, ele continua
 * auto-descritivo.
 */

const PREFIXO_ENV = "CRYPTO_KEY_V";
const TAM_IV = 12; // 96 bits, tamanho canônico do GCM
const TAM_TAG = 16;

/** Cache das chaves já decodificadas — evita base64 a cada chamada. */
const cacheChaves = new Map<number, Buffer>();

function chaveDaVersao(versao: number): Buffer {
  const emCache = cacheChaves.get(versao);
  if (emCache) return emCache;

  const bruta = process.env[`${PREFIXO_ENV}${versao}`];
  if (!bruta) {
    throw new Error(
      `Chave de criptografia ${PREFIXO_ENV}${versao} não configurada. ` +
        `Gere uma com: openssl rand -base64 32`,
    );
  }

  const chave = Buffer.from(bruta, "base64");
  if (chave.length !== 32) {
    throw new Error(
      `${PREFIXO_ENV}${versao} precisa ter 32 bytes em base64 (tem ${chave.length}).`,
    );
  }

  cacheChaves.set(versao, chave);
  return chave;
}

export function versaoAtual(): number {
  const v = Number(process.env.CRYPTO_KEY_VERSAO ?? "1");
  if (!Number.isInteger(v) || v < 1) {
    throw new Error("CRYPTO_KEY_VERSAO precisa ser um inteiro >= 1.");
  }
  return v;
}

/**
 * O `contexto` vira AAD (dado autenticado mas não cifrado). Ele amarra o texto
 * cifrado ao lugar onde ele mora.
 *
 * Por que isso importa: sem AAD, um atacante com acesso de escrita ao banco
 * (ou um bug nosso num UPDATE) poderia copiar o `token_cif` da organização A
 * para a linha da organização B. O valor decifraria normalmente e a org B
 * passaria a enviar WhatsApp pela conta da org A. Com AAD = "canal:<org_id>",
 * a autenticação do GCM falha e o decifrar lança.
 *
 * Use sempre algo estável e único do dono: `canal:<org_id>`, `mp:<org_id>`.
 */
export function cifrar(texto: string, contexto: string): string {
  const versao = versaoAtual();
  const iv = randomBytes(TAM_IV);
  const cipher = createCipheriv("aes-256-gcm", chaveDaVersao(versao), iv);
  cipher.setAAD(Buffer.from(contexto, "utf8"));

  const cifrado = Buffer.concat([
    cipher.update(texto, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    `v${versao}`,
    iv.toString("base64url"),
    tag.toString("base64url"),
    cifrado.toString("base64url"),
  ].join(".");
}

export function decifrar(guardado: string, contexto: string): string {
  const partes = guardado.split(".");
  if (partes.length !== 4 || !partes[0].startsWith("v")) {
    throw new Error("Valor cifrado com formato inválido.");
  }

  const versao = Number(partes[0].slice(1));
  if (!Number.isInteger(versao)) {
    throw new Error("Valor cifrado com versão de chave inválida.");
  }

  const iv = Buffer.from(partes[1], "base64url");
  const tag = Buffer.from(partes[2], "base64url");
  if (iv.length !== TAM_IV || tag.length !== TAM_TAG) {
    throw new Error("Valor cifrado com formato inválido.");
  }

  const decipher = createDecipheriv("aes-256-gcm", chaveDaVersao(versao), iv);
  decipher.setAAD(Buffer.from(contexto, "utf8"));
  decipher.setAuthTag(tag);

  return Buffer.concat([
    decipher.update(Buffer.from(partes[3], "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** Lê a versão sem decifrar — útil no script de rotação de chaves. */
export function versaoDoValor(guardado: string): number | null {
  const v = Number(guardado.split(".")[0]?.slice(1));
  return Number.isInteger(v) ? v : null;
}

// ---------------------------------------------------------------------------
// Tokens opacos (sessão, convite, verificação de e-mail)
// ---------------------------------------------------------------------------

/**
 * Gera um token aleatório para o usuário e o hash correspondente para o banco.
 *
 * O banco guarda só o hash. Se o dump vazar, os cookies de sessão já emitidos
 * não servem para nada — o mesmo raciocínio de senha, aplicado a sessão.
 *
 * Aqui é SHA-256 com HMAC, não scrypt: o token já tem 256 bits de entropia
 * real, então não existe ataque de dicionário para encarecer. Custo alto aqui
 * só deixaria toda requisição autenticada mais lenta.
 *
 * O HMAC (com AUTH_SECRET) em vez de SHA-256 puro serve para que um vazamento
 * só do banco não permita testar candidatos offline sem também ter o segredo
 * da aplicação.
 */
export function gerarToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHmac("sha256", segredoAuth()).update(token).digest("hex");
}

/**
 * Comparação de strings em tempo constante, para quando compararmos tokens
 * fora do banco (ex.: verify_token do webhook da Meta).
 */
export function igualSeguro(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  // timingSafeEqual exige mesmo tamanho; o length em si não é segredo aqui.
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function segredoAuth(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      "AUTH_SECRET não configurado (mínimo 32 caracteres). " +
        "Gere com: openssl rand -base64 32",
    );
  }
  return s;
}
