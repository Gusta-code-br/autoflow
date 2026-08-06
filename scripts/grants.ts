/**
 * Aplica os GRANTs nos papéis da aplicação. Roda depois das migrações.
 * Separado do runner de migração de propósito: os papéis são infraestrutura
 * do ambiente, não parte do schema versionado.
 */
import postgres from "postgres";

import { SQL_GRANTS } from "./pg-local";

async function principal(): Promise<void> {
  const url =
    process.env.DATABASE_URL_MIGRACAO ?? process.env.DATABASE_URL_DIRETA;
  if (!url) throw new Error("DATABASE_URL_MIGRACAO não configurada");

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(SQL_GRANTS);
    console.log("[grants] aplicados em autoflow_app e autoflow_worker");
  } finally {
    await sql.end();
  }
}

principal().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
