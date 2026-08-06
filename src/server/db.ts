import "server-only";

import postgres from "postgres";

/**
 * Acesso ao Postgres. Este é o único módulo que lê `DATABASE_URL` —
 * recomendação do guia de segurança de dados do Next: segredo não circula fora
 * da camada de acesso.
 */

declare global {
  // `var` é obrigatório aqui: `let`/`const` não criam propriedade em globalThis.
  var __autoflow_sql: postgres.Sql | undefined;
  var __autoflow_sql_admin: postgres.Sql | undefined;
}

function criarConexao(url: string, max: number): postgres.Sql {
  return postgres(url, {
    // O app roda como papel sem BYPASSRLS. Toda query passa por policy.
    max,
    idle_timeout: 30,
    connect_timeout: 10,
    prepare: true,
    // bigint de centavos: devolver como string e converter explicitamente é
    // melhor que perder precisão silenciosamente em Number.
    types: {
      bigint: postgres.BigInt,
    },
    onnotice: () => {},
  });
}

/**
 * Em dev o Next recarrega módulos a cada edição; sem o cache global cada
 * recarga abre um pool novo e o Postgres estoura o limite de conexões.
 */
function urlDoApp(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não configurada");
  return url;
}

/**
 * O pool nasce na primeira query, não no `import`.
 *
 * Isso não é preciosismo: o `next build` importa todo módulo alcançável para
 * coletar as rotas. Se a conexão (e a leitura de `DATABASE_URL`) acontecesse
 * na avaliação do módulo, o build quebraria em máquina sem banco — e, pior,
 * qualquer rota que só *toca* neste arquivo abriria um pool sem precisar.
 */
function preguicoso(criar: () => postgres.Sql): postgres.Sql {
  let real: postgres.Sql | undefined;
  const resolver = (): postgres.Sql => (real ??= criar());

  // O Proxy preserva as duas formas de uso: `sql\`SELECT 1\`` (apply) e
  // `sql.begin(...)` / `sql.end(...)` (get).
  return new Proxy(function () {} as unknown as postgres.Sql, {
    apply(_alvo, _this, args: unknown[]) {
      return (resolver() as unknown as (...a: unknown[]) => unknown)(...args);
    },
    get(_alvo, prop) {
      const alvo = resolver() as unknown as Record<string | symbol, unknown>;
      const valor = alvo[prop];
      return typeof valor === "function" ? valor.bind(alvo) : valor;
    },
  });
}

export const sql: postgres.Sql = preguicoso(
  () =>
    (globalThis.__autoflow_sql ??= criarConexao(
      urlDoApp(),
      Number(process.env.DB_POOL_MAX ?? 10),
    )),
);

/**
 * Pool do worker: papel BYPASSRLS, conexão direta (sem pooler) porque
 * `FOR UPDATE SKIP LOCKED` precisa de sessão real, não de statement pooling.
 * Sem isso o worker rodaria sob RLS com `app.org_id` vazio e a fila voltaria
 * sempre vazia — bug mudo, o pior tipo.
 */
const sqlAdmin: postgres.Sql = preguicoso(
  () =>
    (globalThis.__autoflow_sql_admin ??= criarConexao(
      process.env.DATABASE_URL_DIRETA ?? urlDoApp(),
      Number(process.env.DB_POOL_WORKER ?? 4),
    )),
);

export type Transacao = postgres.TransactionSql;

/**
 * Executa dentro de uma transação com `app.org_id` setado.
 *
 * É isso que arma as policies de RLS do schema. `set_config(..., true)` é
 * LOCAL: vale só até o fim da transação, então a conexão volta limpa para o
 * pool. Sem o `true`, a organização vazaria para a próxima requisição que
 * pegasse a mesma conexão — que é exatamente o vazamento entre clientes que o
 * RLS deveria impedir.
 */
export async function comOrg<T>(
  orgId: string,
  fn: (tx: Transacao) => Promise<T>,
): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) {
    throw new Error("org_id inválido");
  }

  return sql.begin(async (tx) => {
    await tx`SELECT set_config('app.org_id', ${orgId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

/**
 * Para o worker e migrações: sem organização no contexto. Só pode ser usado
 * por código que já filtra por org explicitamente na query.
 */
export async function comAdmin<T>(
  fn: (tx: Transacao) => Promise<T>,
): Promise<T> {
  return sqlAdmin.begin(async (tx) => fn(tx)) as Promise<T>;
}

/**
 * Fecha os dois pools — usado pelo worker no SIGTERM.
 *
 * Olha o global direto em vez de usar `sql`/`sqlAdmin`: tocar nos proxies
 * criaria a conexão que estamos justamente tentando não ter.
 */
export async function fecharConexoes(timeout = 5): Promise<void> {
  const abertos = [globalThis.__autoflow_sql, globalThis.__autoflow_sql_admin];
  await Promise.all(abertos.map((pool) => pool?.end({ timeout })));
  globalThis.__autoflow_sql = undefined;
  globalThis.__autoflow_sql_admin = undefined;
}

/** Centavos vêm do Postgres como bigint; a aplicação trabalha com number. */
export function centavos(v: bigint | number | string): number {
  const n = typeof v === "bigint" ? Number(v) : Number(v);
  if (!Number.isSafeInteger(n)) throw new Error(`centavos fora de faixa: ${v}`);
  return n;
}
