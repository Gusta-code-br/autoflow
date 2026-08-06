-- 0003_operacional.sql
-- Tabelas de infraestrutura que não são "domínio", mas que precisam ser
-- duráveis e compartilhadas entre instâncias do app (Vercel escala horizontal:
-- qualquer estado em memória de processo é perdido e não é compartilhado).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Rate limit persistente
-- ---------------------------------------------------------------------------
-- Janela fixa por chave. Escolhi janela fixa (e não sliding window) porque:
--   * é uma linha só por chave, sem lista de timestamps para podar;
--   * o custo de um burst na virada da janela (2x o limite) é aceitável para
--     login/registro/envio, que é o que estamos protegendo;
--   * o UPSERT abaixo é atômico, então não há corrida entre instâncias.
--
-- A chave é opaca: "login:email@x.com", "registro:1.2.3.4", "envio:<org_id>".
-- Nunca guardamos a chave crua quando ela contém dado pessoal — quem chama
-- passa o hash (ver limite.ts). Aqui é só uma string.
CREATE TABLE limite_taxa (
  chave           text        PRIMARY KEY,
  contagem        integer     NOT NULL DEFAULT 0,
  janela_inicio   timestamptz NOT NULL DEFAULT now(),
  janela_seg      integer     NOT NULL,
  bloqueado_ate   timestamptz,                       -- penalidade após estourar
  atualizado_em   timestamptz NOT NULL DEFAULT now()
);

-- Para a limpeza periódica do worker; linhas velhas não têm valor nenhum.
CREATE INDEX ix_limite_atualizado ON limite_taxa (atualizado_em);

-- ---------------------------------------------------------------------------
-- 2. Idempotência de Server Actions
-- ---------------------------------------------------------------------------
-- Server Action é um POST comum: o usuário pode clicar duas vezes, o navegador
-- pode reenviar, e a Vercel pode reexecutar em timeout. Para operações que
-- gastam dinheiro/crédito (criar cobrança, comprar créditos) o cliente manda
-- uma chave e a gente devolve o mesmo resultado em vez de duplicar.
CREATE TABLE acao_idempotente (
  chave       text        PRIMARY KEY,               -- "<org_id>:<acao>:<uuid do cliente>"
  org_id      uuid        NOT NULL REFERENCES organizacao(id) ON DELETE CASCADE,
  resultado   jsonb       NOT NULL,
  criado_em   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_acao_idem_criado ON acao_idempotente (criado_em);

-- O bloco DO do 0001 já rodou; tabela nova com org_id precisa da policy à mão.
-- `limite_taxa` fica de fora de propósito: ela é consultada no login, antes de
-- existir organização no contexto (mesmo motivo de `membro` e `convite`).
ALTER TABLE acao_idempotente ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolamento_tenant ON acao_idempotente
  USING (org_id = app_org()) WITH CHECK (org_id = app_org());

-- ---------------------------------------------------------------------------
-- 3. Nota sobre `organizacao` e RLS
-- ---------------------------------------------------------------------------
-- A tabela `organizacao` NÃO tem policy, e isso é deliberado (não esquecimento):
-- o bloco do 0001 varre tabelas que têm a coluna `org_id`, e a organização se
-- identifica pelo próprio `id`. Uma policy `USING (id = app_org())` quebraria
-- os dois momentos em que a linha precisa ser lida sem organização no contexto:
--   1. `getContexto()` — o JOIN que descobre qual é a organização do usuário;
--   2. o cadastro — o INSERT acontece antes de existir qualquer `app.org_id`.
-- A proteção real dessa tabela é a DAL, que só a alcança via `membro` filtrado
-- por `usuario_id` da sessão. Se um dia quisermos RLS aqui, o caminho é passar
-- também `SET LOCAL app.usuario_id` e escrever a policy contra `membro`.

COMMIT;
