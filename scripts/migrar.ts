/**
 * Runner de migração.
 *
 * Aplica os arquivos de `db/migrations` em ordem, um por transação, e grava
 * nome + checksum. Duas regras que evitam a maior parte dos acidentes:
 *
 *   1. arquivo já aplicado com conteúdo diferente é erro, não "reaplica" —
 *      editar migração antiga é como reescrever a história do banco;
 *   2. `LOCK TABLE schema_migracao` serializa dois deploys simultâneos.
 *
 * Uso: `npm run db:migrate` (ou `... -- --dry` para só listar o que falta).
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";

const DIR = path.join(process.cwd(), "db", "migrations");

function url(): string {
  const u =
    process.env.DATABASE_URL_MIGRACAO ??
    process.env.DATABASE_URL_DIRETA ??
    process.env.DATABASE_URL;
  if (!u) throw new Error("DATABASE_URL não configurada");
  return u;
}

function checksum(conteudo: string): string {
  return createHash("sha256").update(conteudo).digest("hex").slice(0, 16);
}

interface Arquivo {
  nome: string;
  sql: string;
  checksum: string;
}

async function carregar(): Promise<Arquivo[]> {
  const nomes = (await readdir(DIR)).filter((n) => n.endsWith(".sql")).sort();
  return Promise.all(
    nomes.map(async (nome) => {
      const sql = await readFile(path.join(DIR, nome), "utf8");
      return { nome, sql, checksum: checksum(sql) };
    }),
  );
}

async function principal(): Promise<void> {
  const seco = process.argv.includes("--dry");
  const sql = postgres(url(), { max: 1, onnotice: () => {} });

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS schema_migracao (
        nome        text PRIMARY KEY,
        checksum    text NOT NULL,
        aplicada_em timestamptz NOT NULL DEFAULT now(),
        duracao_ms  integer NOT NULL DEFAULT 0
      )
    `;

    const arquivos = await carregar();

    await sql.begin(async (tx) => {
      await tx`LOCK TABLE schema_migracao IN EXCLUSIVE MODE`;

      const aplicadas = new Map(
        (
          await tx<{ nome: string; checksum: string }[]>`
            SELECT nome, checksum FROM schema_migracao
          `
        ).map((l) => [l.nome, l.checksum]),
      );

      for (const arq of arquivos) {
        const anterior = aplicadas.get(arq.nome);

        if (anterior && anterior !== arq.checksum) {
          throw new Error(
            `${arq.nome} já foi aplicada e mudou desde então ` +
              `(${anterior} → ${arq.checksum}). Crie uma migração nova.`,
          );
        }
        if (anterior) continue;

        if (seco) {
          console.log(`[migrar] pendente ${arq.nome}`);
          continue;
        }

        const inicio = Date.now();
        // `.simple()` é obrigatório: o protocolo estendido só aceita um
        // statement por vez, e cada arquivo tem dezenas (além de blocos DO $$).
        await tx.unsafe(arq.sql).simple();
        const ms = Date.now() - inicio;

        await tx`
          INSERT INTO schema_migracao (nome, checksum, duracao_ms)
          VALUES (${arq.nome}, ${arq.checksum}, ${ms})
        `;
        console.log(`[migrar] aplicada ${arq.nome} (${ms}ms)`);
      }
    });

    console.log("[migrar] banco em dia");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

principal().catch((erro: unknown) => {
  console.error("[migrar] falhou:", erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
