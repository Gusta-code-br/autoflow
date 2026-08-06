/**
 * Postgres local descartável, para desenvolvimento e testes de integração.
 *
 * Sobe uma instância embutida em `.pgdata`, cria o banco e — o ponto que
 * importa — cria os DOIS papéis que a aplicação usa em produção:
 *
 *   autoflow_app     → SEM bypassrls. É por onde as Server Actions falam.
 *   autoflow_worker  → COM bypassrls. É por onde o worker varre a fila.
 *
 * Rodar tudo como superusuário (o padrão preguiçoso) faria a RLS passar
 * despercebida: o dono de uma tabela ignora as policies dela a menos que
 * exista FORCE ROW LEVEL SECURITY. Ou seja, um teste feito como superusuário
 * daria verde mesmo com o isolamento de tenant completamente quebrado.
 *
 * Uso:
 *   npm run db:up      sobe e deixa rodando (persistente, guarda os dados)
 *   npm run db:down    derruba e apaga o diretório
 */
import { rm } from "node:fs/promises";
import path from "node:path";

import EmbeddedPostgres from "embedded-postgres";

export const PORTA = Number(process.env.PGPORT_LOCAL ?? 55432);
export const DIR_DADOS = path.join(process.cwd(), ".pgdata");
export const BANCO = "autoflow";

const SUPER_USUARIO = "postgres";
const SUPER_SENHA = "postgres";

/** Senhas locais: não são segredo, o banco só escuta em 127.0.0.1. */
export const SENHA_APP = "app";
export const SENHA_WORKER = "worker";

export function urls(porta = PORTA) {
  const base = `127.0.0.1:${porta}/${BANCO}`;
  return {
    /** Papel do dono: só o runner de migração usa. */
    migracao: `postgres://${SUPER_USUARIO}:${SUPER_SENHA}@${base}`,
    /** Papel da aplicação: sujeito à RLS. */
    app: `postgres://autoflow_app:${SENHA_APP}@${base}`,
    /** Papel do worker: bypassrls. */
    worker: `postgres://autoflow_worker:${SENHA_WORKER}@${base}`,
  };
}

export async function criar(porta = PORTA, dir = DIR_DADOS) {
  return new EmbeddedPostgres({
    databaseDir: dir,
    user: SUPER_USUARIO,
    password: SUPER_SENHA,
    port: porta,
    persistent: true,
  });
}

/**
 * Cria banco e papéis. Idempotente: pode rodar em cima de um cluster que já
 * existe sem estourar.
 */
export async function preparar(pg: EmbeddedPostgres): Promise<void> {
  const cliente = pg.getPgClient();
  await cliente.connect();
  try {
    const { rows } = await cliente.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [BANCO],
    );
    if (rows.length === 0) await cliente.query(`CREATE DATABASE ${BANCO}`);

    // CREATE ROLE não aceita IF NOT EXISTS; o DO resolve.
    await cliente.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autoflow_app') THEN
          CREATE ROLE autoflow_app LOGIN PASSWORD '${SENHA_APP}';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autoflow_worker') THEN
          CREATE ROLE autoflow_worker LOGIN PASSWORD '${SENHA_WORKER}' BYPASSRLS;
        END IF;
      END $$;
    `);
  } finally {
    await cliente.end();
  }
}

/**
 * GRANTs. Roda DEPOIS das migrações, porque só aí as tabelas existem.
 * O ALTER DEFAULT PRIVILEGES cobre tabelas que migrações futuras criarem.
 */
export const SQL_GRANTS = `
  GRANT USAGE ON SCHEMA public TO autoflow_app, autoflow_worker;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
    TO autoflow_app, autoflow_worker;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public
    TO autoflow_app, autoflow_worker;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO autoflow_app, autoflow_worker;
`;

async function principal(): Promise<void> {
  const comando = process.argv[2] ?? "up";

  if (comando === "down") {
    const pg = await criar();
    await pg.stop().catch(() => {});
    await rm(DIR_DADOS, { recursive: true, force: true });
    console.log("banco local removido");
    return;
  }

  const pg = await criar();
  try {
    await pg.initialise();
  } catch (erro) {
    // Já inicializado numa execução anterior: seguir para o start.
    if (!String(erro).includes("exists")) throw erro;
  }
  await pg.start();
  await preparar(pg);

  const u = urls();
  console.log(`postgres de pé em 127.0.0.1:${PORTA}`);
  console.log(`  DATABASE_URL=${u.app}`);
  console.log(`  DATABASE_URL_DIRETA=${u.worker}`);
  console.log(`  DATABASE_URL_MIGRACAO=${u.migracao}`);
}

if (process.argv[1]?.endsWith("pg-local.ts")) {
  principal().catch((erro) => {
    console.error(erro);
    process.exit(1);
  });
}
