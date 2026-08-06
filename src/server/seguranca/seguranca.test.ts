import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { before, describe, it } from "node:test";

/**
 * As chaves precisam existir ANTES do primeiro import de `cripto.ts` — o módulo
 * lê `process.env` na primeira chamada e memoriza no cache. Por isso o import
 * é dinâmico, dentro do `before`.
 */
const chave1 = randomBytes(32).toString("base64");
const chave2 = randomBytes(32).toString("base64");

process.env.CRYPTO_KEY_V1 = chave1;
process.env.CRYPTO_KEY_V2 = chave2;
process.env.CRYPTO_KEY_VERSAO = "1";
process.env.AUTH_SECRET ??= randomBytes(32).toString("base64url");

type Cripto = typeof import("./cripto");
type Senha = typeof import("./senha");

let cripto: Cripto;
let senha: Senha;

before(async () => {
  cripto = await import("./cripto");
  senha = await import("./senha");
});

describe("cifra de segredos de terceiros", () => {
  it("devolve o mesmo texto depois de cifrar e decifrar", () => {
    const token = "EAAG...token-permanente-da-meta";
    const guardado = cripto.cifrar(token, "canal:org-1");

    assert.notEqual(guardado, token);
    assert.equal(cripto.decifrar(guardado, "canal:org-1"), token);
  });

  it("gera saída diferente a cada chamada com o mesmo texto", () => {
    // IV aleatório: dois canais com o mesmo token não podem ter a mesma coluna,
    // senão um dump revela quem compartilha credencial.
    const a = cripto.cifrar("mesmo-token", "canal:org-1");
    const b = cripto.cifrar("mesmo-token", "canal:org-1");
    assert.notEqual(a, b);
    assert.equal(cripto.decifrar(a, "canal:org-1"), cripto.decifrar(b, "canal:org-1"));
  });

  it("recusa valor movido para outra organização", () => {
    // O ponto do AAD: copiar a linha da org A para a org B não funciona.
    const guardado = cripto.cifrar("token-da-org-A", "canal:org-A");
    assert.throws(() => cripto.decifrar(guardado, "canal:org-B"));
  });

  it("recusa valor adulterado byte a byte", () => {
    const guardado = cripto.cifrar("token", "canal:org-1");
    const partes = guardado.split(".");
    const bruto = Buffer.from(partes[3], "base64url");
    bruto[0] ^= 0x01;
    partes[3] = bruto.toString("base64url");

    assert.throws(() => cripto.decifrar(partes.join("."), "canal:org-1"));
  });

  it("recusa formato inválido sem estourar erro de driver", () => {
    assert.throws(() => cripto.decifrar("lixo", "canal:org-1"), /formato inválido/);
    assert.throws(() => cripto.decifrar("v1.a.b", "canal:org-1"), /formato inválido/);
  });

  it("decifra valor da chave antiga depois de girar a versão", () => {
    // Cenário da rotação: valor gravado com v1, aplicação já emitindo v2. Ler o
    // acervo antigo tem que continuar funcionando, senão a rotação vira downtime.
    const antigo = cripto.cifrar("token-antigo", "canal:org-1");
    assert.equal(cripto.versaoDoValor(antigo), 1);

    process.env.CRYPTO_KEY_VERSAO = "2";
    try {
      const novo = cripto.cifrar("token-novo", "canal:org-1");
      assert.equal(cripto.versaoDoValor(novo), 2);
      assert.equal(cripto.decifrar(antigo, "canal:org-1"), "token-antigo");
      assert.equal(cripto.decifrar(novo, "canal:org-1"), "token-novo");
    } finally {
      process.env.CRYPTO_KEY_VERSAO = "1";
    }
  });

  it("versaoDoValor devolve null para valor que não é nosso", () => {
    assert.equal(cripto.versaoDoValor("sem-versao"), null);
  });
});

describe("tokens opacos", () => {
  it("guarda só o hash e confere pelo token", () => {
    const { token, hash } = cripto.gerarToken();

    assert.notEqual(token, hash);
    assert.equal(cripto.hashToken(token), hash);
    assert.notEqual(cripto.hashToken(`${token}x`), hash);
  });

  it("dois tokens seguidos nunca colidem", () => {
    const vistos = new Set(
      Array.from({ length: 200 }, () => cripto.gerarToken().token),
    );
    assert.equal(vistos.size, 200);
  });

  it("igualSeguro compara sem se importar com o tamanho", () => {
    assert.equal(cripto.igualSeguro("abc", "abc"), true);
    assert.equal(cripto.igualSeguro("abc", "abd"), false);
    assert.equal(cripto.igualSeguro("abc", "abcd"), false);
    assert.equal(cripto.igualSeguro("", ""), true);
  });
});

describe("senha", () => {
  it("confere a senha certa e recusa a errada", async () => {
    const hash = await senha.gerarHashSenha("clinica-vitalis-2026");

    assert.match(hash, /^scrypt\$32768\$8\$3\$/);
    assert.equal(await senha.conferirSenha("clinica-vitalis-2026", hash), true);
    assert.equal(await senha.conferirSenha("clinica-vitalis-2025", hash), false);
  });

  it("gera hashes diferentes para a mesma senha", async () => {
    const a = await senha.gerarHashSenha("mesma-senha-boa");
    const b = await senha.gerarHashSenha("mesma-senha-boa");
    assert.notEqual(a, b);
    assert.equal(await senha.conferirSenha("mesma-senha-boa", b), true);
  });

  it("trata acento composto e pré-composto como a mesma senha", async () => {
    // iPhone manda "é" como e + U+0301; Windows manda U+00E9. Sem NFKC o mesmo
    // usuário loga num aparelho e não loga no outro.
    const precomposto = "Jos\u00E9-que-lembra"; // e-acute precomposto
    const decomposto = "Jose\u0301-que-lembra"; // e + acento combinante
    assert.notEqual(precomposto, decomposto);

    const hash = await senha.gerarHashSenha(precomposto);
    assert.equal(await senha.conferirSenha(decomposto, hash), true);
  });

  it("devolve false (nunca lança) para hash corrompido", async () => {
    for (const ruim of [
      "",
      "lixo",
      "scrypt$32768$8$3$sal",
      "bcrypt$32768$8$3$sal$hash",
      "scrypt$abc$8$3$sal$hash",
    ]) {
      assert.equal(await senha.conferirSenha("qualquer", ruim), false);
    }
  });

  it("recusa parâmetro absurdo em vez de derivar", async () => {
    // N=2^30 gravado na coluna viraria DoS de memória no nosso servidor.
    const bomba = `scrypt$${1 << 30}$8$3$c2Fs$${"a".repeat(43)}`;
    assert.equal(await senha.conferirSenha("qualquer", bomba), false);
  });

  it("precisaRehash aponta hash com custo menor que o atual", async () => {
    const atual = await senha.gerarHashSenha("senha-atual-boa");
    assert.equal(senha.precisaRehash(atual), false);
    assert.equal(senha.precisaRehash("scrypt$16384$8$1$c2Fs$aGFzaA"), true);
    assert.equal(senha.precisaRehash("formato-antigo-qualquer"), true);
  });

  it("valida comprimento e barra senha óbvia", () => {
    assert.equal(senha.validarSenha("senha-boa-o-suficiente"), null);
    assert.match(senha.validarSenha("curta") ?? "", /8 caracteres/);
    assert.match(senha.validarSenha("a".repeat(201)) ?? "", /longa demais/);
    assert.match(senha.validarSenha("12345678") ?? "", /adivinhar/);
    assert.match(senha.validarSenha("PASSWORD") ?? "", /adivinhar/);
    assert.match(senha.validarSenha("aaaaaaaaaa") ?? "", /adivinhar/);
  });
});
