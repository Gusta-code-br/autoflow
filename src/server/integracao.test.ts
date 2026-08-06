/**
 * Testes de integração contra Postgres de verdade.
 *
 * Estes testes existem para checar exatamente aquilo que teste unitário com
 * mock nunca pega: RLS, triggers, constraints e o comportamento de bloqueio
 * do `FOR UPDATE SKIP LOCKED`. Um mock sempre concorda com você; o banco não.
 *
 * Pré-requisitos: `npm run db:up && npm run db:migrate && npm run db:grants`.
 * Se `DATABASE_URL` não apontar para um banco de pé, o arquivo inteiro é
 * pulado — não quebra a suíte de quem só quer rodar os testes de unidade.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import postgres from "postgres";

const URL_APP = process.env.DATABASE_URL;
const URL_WORKER = process.env.DATABASE_URL_DIRETA;
const URL_DONO = process.env.DATABASE_URL_MIGRACAO;

/** Duas orgs de teste, criadas uma vez e limpas no fim. */
let orgA = "";
let orgB = "";

let dono: postgres.Sql;
let app: postgres.Sql;
let worker: postgres.Sql;

/**
 * Condição de skip precisa ser síncrona (o `describe` decide na hora da
 * chamada), então olhamos só as variáveis de ambiente. Quem não tem `.env`
 * — CI limpo, clone novo — pula o arquivo inteiro. Se as variáveis existem
 * mas o banco está fora, o `before` estoura, e é isso mesmo que queremos:
 * banco configurado e inacessível é erro, não motivo para pular em silêncio.
 */
const temBanco = Boolean(URL_APP && URL_WORKER && URL_DONO);

describe("integração com Postgres", { skip: !temBanco }, () => {
  before(async () => {
    dono = postgres(URL_DONO!, { max: 2, onnotice: () => {} });
    app = postgres(URL_APP!, { max: 4, onnotice: () => {} });
    worker = postgres(URL_WORKER!, { max: 2, onnotice: () => {} });

    // Execução anterior morta no meio (Ctrl-C, timeout do CI) não roda o
    // `after` e deixa tenant órfão no banco de desenvolvimento — que depois
    // aparece no painel e confunde o smoke. Varre antes de criar os novos.
    await dono`DELETE FROM organizacao WHERE slug LIKE 'teste-a-%' OR slug LIKE 'teste-b-%'`;

    const [a] = await dono`
      INSERT INTO organizacao (nome_empresa, slug)
      VALUES ('Org A', ${"teste-a-" + Date.now()})
      RETURNING id`;
    const [b] = await dono`
      INSERT INTO organizacao (nome_empresa, slug)
      VALUES ('Org B', ${"teste-b-" + Date.now()})
      RETURNING id`;
    orgA = a.id;
    orgB = b.id;
  });

  after(async () => {
    if (dono) {
      await dono`DELETE FROM organizacao WHERE id IN (${orgA}, ${orgB})`;
      await dono.end();
    }
    await app?.end();
    await worker?.end();
  });

  // ---------------------------------------------------------------------------
  // O papel da aplicação precisa estar sujeito à RLS. Se este teste falhar,
  // todos os outros de isolamento são teatro.
  // ---------------------------------------------------------------------------
  it("papel do app não tem bypassrls; o do worker tem", async () => {
    const [a] = await app`
      SELECT rolbypassrls AS bypassa FROM pg_roles WHERE rolname = current_user`;
    const [w] = await worker`
      SELECT rolbypassrls AS bypassa FROM pg_roles WHERE rolname = current_user`;

    assert.equal(a.bypassa, false, "autoflow_app NÃO pode bypassar RLS");
    assert.equal(w.bypassa, true, "autoflow_worker precisa bypassar RLS");
  });

  it("RLS esconde o contato de outra org", async () => {
    await dono`
      INSERT INTO contato (org_id, nome, telefone_e164)
      VALUES (${orgA}, 'Cliente da A', '+5511999990001'),
             (${orgB}, 'Cliente da B', '+5511999990002')`;

    const daA = await app.begin(async (tx) => {
      await tx`SELECT set_config('app.org_id', ${orgA}, true)`;
      return tx`SELECT nome FROM contato ORDER BY nome`;
    });

    assert.equal(daA.length, 1);
    assert.equal(daA[0].nome, "Cliente da A");
  });

  it("sem app.org_id no contexto, o app não vê contato nenhum", async () => {
    // Falha fechado: contexto ausente não é "vê tudo", é "não vê nada".
    const linhas = await app`SELECT id FROM contato`;
    assert.equal(linhas.length, 0);
  });

  it("RLS impede gravar linha carimbada com outra org", async () => {
    await assert.rejects(
      app.begin(async (tx) => {
        await tx`SELECT set_config('app.org_id', ${orgA}, true)`;
        // Contexto é da A, mas a linha diz B: o WITH CHECK tem que barrar.
        return tx`
          INSERT INTO contato (org_id, nome, telefone_e164)
          VALUES (${orgB}, 'Intruso', '+5511999990003')`;
      }),
      /row-level security|violates/i,
    );
  });

  it("o worker enxerga as duas orgs", async () => {
    const linhas = await worker`
      SELECT org_id FROM contato WHERE org_id IN (${orgA}, ${orgB})`;
    const orgs = new Set(linhas.map((l) => l.org_id));
    assert.equal(orgs.size, 2);
  });

  // ---------------------------------------------------------------------------
  // Créditos são dinheiro. O saldo tem que sair do ledger e não de um UPDATE
  // solto que qualquer caminho de código pode esquecer de fazer.
  // ---------------------------------------------------------------------------
  describe("trigger de crédito", () => {
    it("credita, debita e carimba saldo_apos a cada movimento", async () => {
      await dono`
        INSERT INTO movimento_credito (org_id, tipo, quantidade, idempotencia)
        VALUES (${orgA}, 'compra', 1000, 'teste-compra-1')`;
      await dono`
        INSERT INTO movimento_credito (org_id, tipo, quantidade, idempotencia)
        VALUES (${orgA}, 'consumo', -300, 'teste-consumo-1')`;

      const [org] = await dono`
        SELECT saldo_creditos FROM organizacao WHERE id = ${orgA}`;
      assert.equal(Number(org.saldo_creditos), 700);

      const mov = await dono`
        SELECT saldo_apos FROM movimento_credito
         WHERE org_id = ${orgA} ORDER BY id`;
      assert.deepEqual(
        mov.map((m) => Number(m.saldo_apos)),
        [1000, 700],
        "saldo_apos precisa ser o extrato, não o saldo final repetido",
      );
    });

    it("recusa débito que deixaria o saldo negativo", async () => {
      await assert.rejects(
        dono`
          INSERT INTO movimento_credito (org_id, tipo, quantidade, idempotencia)
          VALUES (${orgA}, 'consumo', -999999, 'teste-estouro')`,
        /saldo de créditos insuficiente/,
      );

      // E o saldo não pode ter ficado sujo pelo UPDATE que rodou antes do RAISE.
      const [org] = await dono`
        SELECT saldo_creditos FROM organizacao WHERE id = ${orgA}`;
      assert.equal(Number(org.saldo_creditos), 700);
    });

    it("idempotência bloqueia crédito repetido", async () => {
      // Webhook de pagamento reentregue não pode creditar duas vezes.
      await assert.rejects(
        dono`
          INSERT INTO movimento_credito (org_id, tipo, quantidade, idempotencia)
          VALUES (${orgA}, 'compra', 1000, 'teste-compra-1')`,
        /duplicate key|unique/i,
      );

      const [org] = await dono`
        SELECT saldo_creditos FROM organizacao WHERE id = ${orgA}`;
      assert.equal(Number(org.saldo_creditos), 700);
    });
  });

  // ---------------------------------------------------------------------------
  // Dois workers na mesma fila não podem pegar o mesmo disparo — senão o
  // cliente recebe a mesma cobrança duas vezes.
  // ---------------------------------------------------------------------------
  it("FOR UPDATE SKIP LOCKED não entrega o mesmo disparo a dois workers", async () => {
    // Fixture: contato → cobrança → régua → etapa → execução → disparo.
    const [contato] = await dono`
      INSERT INTO contato (org_id, nome, telefone_e164)
      VALUES (${orgA}, 'Fila', '+5511999990010') RETURNING id`;
    const [cobranca] = await dono`
      INSERT INTO cobranca (org_id, contato_id, descricao, valor, vencimento)
      VALUES (${orgA}, ${contato.id}, 'Teste', 10000, CURRENT_DATE) RETURNING id`;
    const [regua] = await dono`
      INSERT INTO regua (org_id, nome) VALUES (${orgA}, 'R') RETURNING id`;
    const [etapa] = await dono`
      INSERT INTO regua_etapa (regua_id, ordem, mensagem)
      VALUES (${regua.id}, 1, 'oi') RETURNING id`;
    const [execucao] = await dono`
      INSERT INTO regua_execucao (org_id, cobranca_id, regua_id)
      VALUES (${orgA}, ${cobranca.id}, ${regua.id}) RETURNING id`;
    const [disparo] = await dono`
      INSERT INTO disparo (org_id, execucao_id, etapa_id, cobranca_id, executar_em)
      VALUES (${orgA}, ${execucao.id}, ${etapa.id}, ${cobranca.id}, now() - interval '1 minute')
      RETURNING id`;

    const pegarFila = (tx: postgres.TransactionSql) => tx`
      SELECT id FROM disparo
       WHERE status = 'agendado' AND executar_em <= now() AND org_id = ${orgA}
       ORDER BY executar_em
       FOR UPDATE SKIP LOCKED`;

    // Worker 1 abre a transação, pega a linha e SEGURA o lock.
    let liberar!: () => void;
    const travado = new Promise<void>((r) => (liberar = r));
    let pegouW1: unknown[] = [];

    const w1 = worker.begin(async (tx) => {
      pegouW1 = await pegarFila(tx);
      await travado; // mantém o lock aberto enquanto o worker 2 tenta
    });

    // Espera o worker 1 realmente ter travado a linha antes de concorrer.
    await new Promise((r) => setTimeout(r, 150));

    const pegouW2 = await worker.begin(async (tx) => pegarFila(tx));

    liberar();
    await w1;

    assert.equal(pegouW1.length, 1, "worker 1 devia pegar o disparo");
    assert.equal(
      pegouW2.length,
      0,
      "worker 2 devia PULAR a linha travada, não esperar nem duplicar",
    );
    assert.equal((pegouW1[0] as { id: string }).id, disparo.id);
  });

  it("set_config LOCAL não vaza para a próxima transação da mesma conexão", async () => {
    // O pool reusa conexão; se o SET não fosse LOCAL, a org da requisição
    // anterior sobreviveria para a seguinte. Esse é o vazamento entre
    // clientes que a RLS deveria impedir — então vale checar de perto.
    const solo = postgres(URL_APP!, { max: 1, onnotice: () => {} });
    try {
      await solo.begin(async (tx) => {
        await tx`SELECT set_config('app.org_id', ${orgA}, true)`;
        return tx`SELECT 1`;
      });

      const [{ vazou }] = await solo`
        SELECT current_setting('app.org_id', true) AS vazou`;
      assert.ok(
        vazou === null || vazou === "",
        `org_id vazou entre transações: ${vazou}`,
      );
    } finally {
      await solo.end();
    }
  });
});
