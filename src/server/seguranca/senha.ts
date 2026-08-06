import "server-only";

import {
  randomBytes,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";
import { promisify } from "node:util";

// `promisify` escolhe a sobrecarga sem `options`; declaramos a que usamos.
const scryptAsync = promisify(scrypt) as (
  senha: string | Buffer,
  sal: string | Buffer,
  tamanho: number,
  opcoes: ScryptOptions,
) => Promise<Buffer>;

/**
 * Hash de senha com scrypt (nativo do Node — zero dependência, zero build
 * nativo, roda igual em Vercel/Docker/local).
 *
 * Por que scrypt e não bcrypt/argon2:
 *   - argon2id seria a primeira escolha teórica, mas exige binding nativo
 *     (@node-rs/argon2), o que complica deploy serverless e CI.
 *   - bcrypt trunca em 72 bytes e é fraco contra GPU comparado a scrypt.
 *   - scrypt é memory-hard e vem no core. Bom o bastante quando parametrizado
 *     conforme a OWASP Password Storage Cheat Sheet.
 *
 * Parâmetros: N=2^15, r=8, p=3 — é uma das combinações recomendadas pela OWASP
 * (as alternativas são N=2^17/r=8/p=1 e N=2^16/r=8/p=2). Escolhi a de menor
 * memória (32 MiB) porque função serverless tem teto de RAM e vários logins
 * simultâneos no mesmo container somariam 128 MiB cada com a config mais
 * pesada. O `p=3` recompõe o custo de CPU.
 */
const N = 32768; // 2^15
const R = 8;
const P = 3;
const TAM_CHAVE = 32;
const TAM_SAL = 16;

// 128 * N * r = 32 MiB de fato usados; o default do Node é 32 MiB e estoura por
// causa do overhead interno, então subimos o teto explicitamente.
const MAX_MEM = 64 * 1024 * 1024;

/**
 * Formato guardado: `scrypt$N$r$p$<sal base64url>$<hash base64url>`.
 *
 * Guardar os parâmetros junto do hash é o que permite trocar o custo depois
 * (ou migrar de algoritmo) sem invalidar as senhas existentes: a verificação lê
 * os parâmetros da própria linha.
 */
export async function gerarHashSenha(senha: string): Promise<string> {
  const sal = randomBytes(TAM_SAL);
  const derivada = (await scryptAsync(normalizar(senha), sal, TAM_CHAVE, {
    N,
    r: R,
    p: P,
    maxmem: MAX_MEM,
  })) as Buffer;

  return [
    "scrypt",
    N,
    R,
    P,
    sal.toString("base64url"),
    derivada.toString("base64url"),
  ].join("$");
}

/**
 * Verifica a senha em tempo constante.
 *
 * Nunca lança por hash malformado: retorna false. Um erro aqui vazaria, pelo
 * comportamento da resposta, que aquele e-mail existe mas está com registro
 * corrompido — informação que não interessa a ninguém de fora.
 */
export async function conferirSenha(
  senha: string,
  hashGuardado: string,
): Promise<boolean> {
  const partes = hashGuardado.split("$");
  if (partes.length !== 6 || partes[0] !== "scrypt") return false;

  const n = Number(partes[1]);
  const r = Number(partes[2]);
  const p = Number(partes[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }
  // Trava de sanidade: se alguém conseguisse gravar N=2^30 na coluna, cada
  // tentativa de login viraria um DoS de memória no nosso próprio servidor.
  if (n > 1 << 17 || r > 16 || p > 16) return false;

  let esperado: Buffer;
  try {
    esperado = Buffer.from(partes[5], "base64url");
  } catch {
    return false;
  }
  if (esperado.length !== TAM_CHAVE) return false;

  const sal = Buffer.from(partes[4], "base64url");

  try {
    const derivada = (await scryptAsync(normalizar(senha), sal, TAM_CHAVE, {
      N: n,
      r,
      p,
      maxmem: MAX_MEM,
    })) as Buffer;
    return timingSafeEqual(derivada, esperado);
  } catch {
    return false;
  }
}

/**
 * Indica que o hash foi gerado com custo menor do que o atual. O login chama
 * isso depois de autenticar com sucesso e regrava o hash — é a única hora em
 * que temos a senha em claro para poder re-derivar.
 */
export function precisaRehash(hashGuardado: string): boolean {
  const partes = hashGuardado.split("$");
  if (partes.length !== 6 || partes[0] !== "scrypt") return true;
  return Number(partes[1]) < N || Number(partes[2]) < R || Number(partes[3]) < P;
}

/**
 * Regras mínimas de senha.
 *
 * Deliberadamente sem exigência de "1 maiúscula, 1 símbolo": a orientação atual
 * (NIST 800-63B) é priorizar comprimento e barrar senhas óbvias, porque regras
 * de composição empurram o usuário para "Senha@123". O dono de clínica não vai
 * usar gerenciador de senha; comprimento mínimo alto + bloqueio de tentativas
 * protege mais do que exigir caractere especial.
 */
const SENHAS_OBVIAS = new Set([
  "12345678",
  "123456789",
  "1234567890",
  "senha123",
  "password",
  "qwertyui",
  "admin123",
  "whatsapp",
  "mudar123",
]);

export function validarSenha(senha: string): string | null {
  if (senha.length < 8) return "A senha precisa de pelo menos 8 caracteres.";
  // Limite alto, mas existente: scrypt processa a senha inteira, então um campo
  // sem teto vira vetor de DoS (1 MB de senha = trabalho gratuito no servidor).
  if (senha.length > 200) return "A senha é longa demais.";
  if (SENHAS_OBVIAS.has(senha.toLowerCase())) {
    return "Essa senha é fácil demais de adivinhar. Escolha outra.";
  }
  if (/^(.)\1+$/.test(senha)) {
    return "Essa senha é fácil demais de adivinhar. Escolha outra.";
  }
  return null;
}

/**
 * Normaliza para NFKC antes de derivar.
 *
 * Sem isso, "José123" digitado no teclado do iPhone (que compõe o "é" como
 * e + acento) gera bytes diferentes do mesmo texto digitado no Windows, e o
 * usuário não consegue logar em um dos dois aparelhos. É um bug que só aparece
 * em produção, com acento, que é exatamente o nosso público.
 */
function normalizar(senha: string): Buffer {
  return Buffer.from(senha.normalize("NFKC"), "utf8");
}
