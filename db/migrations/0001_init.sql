-- =============================================================================
-- AutoFlow — migration inicial
-- Postgres 17 (Neon).  Convenções:
--   • dinheiro em BIGINT de centavos (nunca float)
--   • todo instante é TIMESTAMPTZ; hora local do negócio usa TIME + organizacao.fuso
--   • toda tabela de tenant carrega org_id (FK ON DELETE CASCADE) e tem RLS ligada
-- =============================================================================

BEGIN;

-- 0. Extensões ---------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 1. Enums -------------------------------------------------------------------
CREATE TYPE feature            AS ENUM ('atendimento','cobranca','agendamento');
CREATE TYPE papel_membro       AS ENUM ('dono','admin','atendente');
CREATE TYPE periodicidade      AS ENUM ('mensal','semestral','anual');
CREATE TYPE status_assinatura  AS ENUM ('trial','ativa','inadimplente','cancelada','expirada');

CREATE TYPE status_pagamento   AS ENUM ('pendente','aprovado','recusado','estornado','expirado');
CREATE TYPE metodo_pagamento   AS ENUM ('pix','cartao','boleto');
CREATE TYPE tipo_pagamento     AS ENUM ('assinatura','creditos','conexao','cobranca_cliente');
CREATE TYPE tipo_movimento     AS ENUM ('compra','bonus_plano','consumo','estorno','expiracao','ajuste');

CREATE TYPE provedor_canal     AS ENUM ('meta_cloud','evolution');
CREATE TYPE status_canal       AS ENUM ('pendente','conectado','desconectado','banido');
CREATE TYPE status_template    AS ENUM ('rascunho','em_analise','aprovado','rejeitado','pausado','desabilitado');
CREATE TYPE categoria_template AS ENUM ('utility','marketing','authentication');

CREATE TYPE direcao_mensagem   AS ENUM ('entrada','saida');
CREATE TYPE autor_mensagem     AS ENUM ('contato','ia','humano','sistema');
CREATE TYPE status_mensagem    AS ENUM ('pendente','enviada','entregue','lida','falhou');
CREATE TYPE modo_conversa      AS ENUM ('ia','humano');
CREATE TYPE intencao           AS ENUM ('cobranca','agendamento','duvida','suporte','outro');

CREATE TYPE status_cobranca    AS ENUM ('pendente','pago','vencido','negociando','cancelado');
CREATE TYPE referencia_etapa   AS ENUM ('emissao','vencimento','pagamento');
CREATE TYPE condicao_etapa     AS ENUM ('sempre','se_nao_pago','se_pago','se_sem_resposta');
CREATE TYPE acao_etapa         AS ENUM ('enviar_whatsapp','notificar_voce','oferecer_parcelamento','marcar_perdido');
CREATE TYPE status_execucao    AS ENUM ('ativa','pausada','concluida','cancelada');
CREATE TYPE status_disparo     AS ENUM ('agendado','processando','enviado','ignorado','falhou','cancelado');

CREATE TYPE status_agendamento AS ENUM ('pendente','confirmado','cancelado','concluido','faltou');
CREATE TYPE origem_registro    AS ENUM ('ia','manual','api');

-- Função de trigger reutilizada por todas as tabelas com atualizado_em
CREATE FUNCTION tg_atualizado_em() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.atualizado_em = now();
  RETURN NEW;
END $$;

-- =============================================================================
-- 2. Identidade e tenant
-- =============================================================================

CREATE TABLE usuario (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              citext NOT NULL UNIQUE,
  senha_hash         text,                       -- null quando só magic link/OAuth
  nome               text NOT NULL,
  telefone           text,
  email_verificado_em timestamptz,
  ultimo_acesso_em   timestamptz,
  criado_em          timestamptz NOT NULL DEFAULT now(),
  atualizado_em      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessao (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,               -- guarda o hash, nunca o token
  ip         inet,
  user_agent text,
  expira_em  timestamptz NOT NULL,
  criado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_sessao_usuario ON sessao (usuario_id);

CREATE TABLE organizacao (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug               citext NOT NULL UNIQUE,
  nome_empresa       text NOT NULL,
  segmento           text,
  fuso               text NOT NULL DEFAULT 'America/Sao_Paulo',

  -- personalidade da IA (vem do onboarding)
  nome_atendente     text NOT NULL DEFAULT 'Ana',
  tom                text NOT NULL DEFAULT 'amigavel',
  objetivos          feature[] NOT NULL DEFAULT '{}',
  instrucoes_extra   text,

  -- expediente
  horario_inicio     time NOT NULL DEFAULT '09:00',
  horario_fim        time NOT NULL DEFAULT '18:00',
  dias_semana        smallint[] NOT NULL DEFAULT '{1,2,3,4,5}',  -- 0=dom … 6=sáb

  -- notificações para o dono
  whatsapp_pessoal   text,
  notificar_novo_agendamento boolean NOT NULL DEFAULT true,
  notificar_pagamento        boolean NOT NULL DEFAULT true,
  notificar_sem_resposta     boolean NOT NULL DEFAULT false,

  chave_pix          text,                       -- fallback quando não há OAuth do MP
  onboarding_completo boolean NOT NULL DEFAULT false,
  saldo_creditos     bigint NOT NULL DEFAULT 0,  -- cache do ledger (ver §10)
  criado_em          timestamptz NOT NULL DEFAULT now(),
  atualizado_em      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ck_org_expediente CHECK (horario_fim > horario_inicio)
);

CREATE TABLE membro (
  org_id     uuid NOT NULL REFERENCES organizacao(id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  papel      papel_membro NOT NULL DEFAULT 'atendente',
  criado_em  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, usuario_id)
);
CREATE INDEX ix_membro_usuario ON membro (usuario_id);
-- exatamente um dono por organização
CREATE UNIQUE INDEX ux_membro_dono ON membro (org_id) WHERE papel = 'dono';

CREATE TABLE convite (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizacao(id) ON DELETE CASCADE,
  email      citext NOT NULL,
  papel      papel_membro NOT NULL DEFAULT 'atendente',
  token_hash text NOT NULL UNIQUE,
  expira_em  timestamptz NOT NULL,
  aceito_em  timestamptz,
  criado_em  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, email)
);

-- =============================================================================
-- 3. Catálogo, assinatura e dinheiro
-- =============================================================================

CREATE TABLE plano (
  id                text PRIMARY KEY,            -- 'essencial' | 'profissional' | 'completo'
  nome              text NOT NULL,
  chamada           text,
  ordem             smallint NOT NULL DEFAULT 0,
  preco_mensal      bigint NOT NULL,             -- centavos
  features          feature[] NOT NULL,
  creditos_mes      integer NOT NULL,
  conexoes_inclusas smallint NOT NULL DEFAULT 1,
  beneficios        jsonb NOT NULL DEFAULT '[]',
  destaque          boolean NOT NULL DEFAULT false,
  ativo             boolean NOT NULL DEFAULT true
);

CREATE TABLE plano_preco (
  plano_id      text NOT NULL REFERENCES plano(id),
  periodicidade periodicidade NOT NULL,
  meses         smallint NOT NULL,
  desconto_bp   integer NOT NULL DEFAULT 0,      -- basis points: 1500 = 15%
  preco_total   bigint NOT NULL,                 -- centavos, já com desconto
  mp_plan_id    text,                            -- preapproval_plan do Mercado Pago
  ativo         boolean NOT NULL DEFAULT true,
  PRIMARY KEY (plano_id, periodicidade)
);

CREATE TABLE pacote_credito (
  id        text PRIMARY KEY,
  creditos  integer NOT NULL,
  preco     bigint NOT NULL,
  selo      text,
  ativo     boolean NOT NULL DEFAULT true
);

CREATE TABLE parametro (                          -- preços avulsos e knobs globais
  chave  text PRIMARY KEY,
  valor  jsonb NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE assinatura (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizacao(id) ON DELETE CASCADE,
  plano_id        text NOT NULL REFERENCES plano(id),
  periodicidade   periodicidade NOT NULL,
  status          status_assinatura NOT NULL DEFAULT 'trial',
  -- preço fechado no ato: protege o cliente antigo de reajuste (grandfathering)
  preco_contratado bigint NOT NULL,
  conexoes_extras smallint NOT NULL DEFAULT 0,
  inicia_em       timestamptz NOT NULL DEFAULT now(),
  expira_em       timestamptz NOT NULL,
  renovacao_automatica boolean NOT NULL DEFAULT true,
  cancelada_em    timestamptz,
  motivo_cancelamento text,
  mp_preapproval_id text UNIQUE,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_assinatura_periodo CHECK (expira_em > inicia_em)
);
-- no máximo uma assinatura vigente por organização
CREATE UNIQUE INDEX ux_assinatura_vigente ON assinatura (org_id)
  WHERE status IN ('trial','ativa','inadimplente');
CREATE INDEX ix_assinatura_expira ON assinatura (expira_em)
  WHERE status IN ('trial','ativa');

-- Credenciais OAuth do Mercado Pago do tenant (emitir PIX em nome dele)
CREATE TABLE integracao_mp (
  org_id            uuid PRIMARY KEY REFERENCES organizacao(id) ON DELETE CASCADE,
  mp_user_id        text NOT NULL,
  access_token_cif  bytea NOT NULL,              -- AES-256-GCM na aplicação
  refresh_token_cif bytea NOT NULL,
  chave_versao      smallint NOT NULL DEFAULT 1,
  escopo            text,
  expira_em         timestamptz NOT NULL,
  taxa_plataforma_bp integer NOT NULL DEFAULT 0, -- application_fee em basis points
  conectado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mp_user_id)
);

CREATE TABLE pagamento (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizacao(id) ON DELETE CASCADE,
  tipo           tipo_pagamento NOT NULL,
  descricao      text NOT NULL,
  valor          bigint NOT NULL,                -- centavos
  taxa_plataforma bigint NOT NULL DEFAULT 0,     -- o que fica com o AutoFlow
  metodo         metodo_pagamento NOT NULL DEFAULT 'pix',
  status         status_pagamento NOT NULL DEFAULT 'pendente',

  -- ligações opcionais conforme o tipo
  assinatura_id  uuid REFERENCES assinatura(id) ON DELETE SET NULL,
  pacote_id      text REFERENCES pacote_credito(id),
  cobranca_id    uuid,                           -- FK adicionada após criar `cobranca`

  -- Mercado Pago
  mp_payment_id  text UNIQUE,
  mp_status_detail text,
  pix_copia_cola text,
  pix_qr_base64  text,
  ticket_url     text,
  expira_em      timestamptz,
  pago_em        timestamptz,
  estornado_em   timestamptz,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_pagamento_valor CHECK (valor > 0)
);
CREATE INDEX ix_pagamento_org ON pagamento (org_id, criado_em DESC);
CREATE INDEX ix_pagamento_pendente ON pagamento (expira_em) WHERE status = 'pendente';

-- Ledger de créditos de IA — append-only, nunca UPDATE de saldo
CREATE TABLE movimento_credito (
  id             bigserial PRIMARY KEY,
  org_id         uuid NOT NULL REFERENCES organizacao(id) ON DELETE CASCADE,
  tipo           tipo_movimento NOT NULL,
  quantidade     integer NOT NULL,               -- + entrada, − consumo
  saldo_apos     bigint NOT NULL,
  origem_tipo    text,                           -- 'pagamento' | 'uso_ia' | 'assinatura'
  origem_id      text,
  -- garante que reprocessar webhook/mensagem não credita nem debita duas vezes
  idempotencia   text NOT NULL,
  expira_em      timestamptz,                    -- crédito de plano expira no ciclo
  criado_em      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_movimento_nao_zero CHECK (quantidade <> 0),
  UNIQUE (org_id, idempotencia)
);
CREATE INDEX ix_movimento_org ON movimento_credito (org_id, criado_em DESC);

-- =============================================================================
-- 4. Canais de WhatsApp e templates
-- =============================================================================

CREATE TABLE canal_whatsapp (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizacao(id) ON DELETE CASCADE,
  provedor          provedor_canal NOT NULL DEFAULT 'meta_cloud',
  nome              text NOT NULL,
  numero_e164       text NOT NULL,
  status            status_canal NOT NULL DEFAULT 'pendente',
  principal         boolean NOT NULL DEFAULT false,

  -- Meta Cloud API
  waba_id           text,
  phone_number_id   text UNIQUE,
  token_cif         bytea,
  chave_versao      smallint NOT NULL DEFAULT 1,
  qualidade         text,                        -- GREEN | YELLOW | RED
  limite_diario     integer,                     -- tier de messaging da Meta

  ultima_sync_em    timestamptz,
  verificado_em     timestamptz,
  criado_em         timestamptz NOT NULL DEFAULT now(),
  atualizado_em     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, numero_e164)
);
CREATE UNIQUE INDEX ux_canal_principal ON canal_whatsapp (org_id) WHERE principal;

CREATE TABLE template_whatsapp (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizacao(id) ON DELETE CASCADE,
  canal_id       uuid REFERENCES canal_whatsapp(id) ON DELETE SET NULL,
  nome           text NOT NULL,                  -- snake_case exigido pela Meta
  idioma         text NOT NULL DEFAULT 'pt_BR',
  categoria      categoria_template NOT NULL DEFAULT 'utility',
  status         status_template NOT NULL DEFAULT 'rascunho',
  corpo          text NOT NULL,                  -- com {{1}}, {{2}} …
  cabecalho      text,
  rodape         text,
  botoes         jsonb NOT NULL DEFAULT '[]',
  -- mapeia posição → variável do domínio: {"1":"contato.primeiro_nome","2":"cobranca.valor"}
  variaveis_map  jsonb NOT NULL DEFAULT '{}',
  meta_template_id text,
  motivo_rejeicao text,
  enviado_em     timestamptz,
  aprovado_em    timestamptz,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, nome, idioma)
);

-- =============================================================================
-- 5. Contatos, conversas e IA
-- =============================================================================

CREATE TABLE contato (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES organizacao(id) ON DELETE CASCADE,
  nome             text NOT NULL,
  telefone_e164    text NOT NULL,
  email            citext,
  documento        text,
  tags             text[] NOT NULL DEFAULT '{}',
  observacao       text,
  -- LGPD / anti-bloqueio: nenhuma régua envia se houver opt-out
  opt_out_em       timestamptz,
  bloqueado        boolean NOT NULL DEFAULT false,
  ultima_interacao_em timestamptz,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, telefone_e164),
  CONSTRAINT ck_contato_e164 CHECK (telefone_e164 ~ '^\+[1-9][0-9]{7,14}$')
);
CREATE INDEX ix_contato_tags ON contato USING gin (tags);
CREATE INDEX ix_contato_busca ON contato USING gin (to_tsvector('portuguese', nome));

CREATE TABLE conversa (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizacao(id) ON DELETE CASCADE,
  contato_id     uuid NOT NULL REFERENCES contato(id) ON DELETE CASCADE,
  canal_id       uuid NOT NULL REFERENCES canal_whatsapp(id) ON DELETE CASCADE,
  modo           modo_conversa NOT NULL DEFAULT 'ia',
  intencao       intencao NOT NULL DEFAULT 'outro',
  resumo_ia      text,
  nao_lidas      integer NOT NULL DEFAULT 0,
  atribuido_a    uuid REFERENCES usuario(id) ON DELETE SET NULL,
  -- Cloud API: fora dessa janela só se inicia conversa com template aprovado
  janela_expira_em timestamptz,
  arquivada_em   timestamptz,
  ultima_atividade_em timestamptz NOT NULL DEFAULT now(),
  criado_em      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, contato_id, canal_id)
);
CREATE INDEX ix_conversa_caixa ON conversa (org_id, ultima_atividade_em DESC)
  WHERE arquivada_em IS NULL;

CREATE TABLE mensagem (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizacao(id) ON DELETE CASCADE,
  conversa_id    uuid NOT NULL REFERENCES conversa(id) ON DELETE CASCADE,
  direcao        direcao_mensagem NOT NULL,
  autor          autor_mensagem NOT NULL,
  autor_usuario_id uuid REFERENCES usuario(id) ON DELETE SET NULL,
  texto          text,
  tipo_midia     text,
  midia_url      text,
  template_id    uuid REFERENCES template_whatsapp(id) ON DELETE SET NULL,
  status         status_mensagem NOT NULL DEFAULT 'pendente',
  erro           text,
  provider_id    text,                           -- wamid da Meta
  enviada_em     timestamptz,
  entregue_em    timestamptz,
  lida_em        timestamptz,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, provider_id)
);
CREATE INDEX ix_mensagem_conversa ON mensagem (conversa_id, criado_em);

-- Consumo real de IA: base do custo e da margem por cliente
CREATE TABLE uso_ia (
  id             bigserial PRIMARY KEY,
  org_id         uuid NOT NULL REFERENCES organizacao(id) ON DELETE CASCADE,
  conversa_id    uuid REFERENCES conversa(id) ON DELETE SET NULL,
  mensagem_id    uuid REFERENCES mensagem(id) ON DELETE SET NULL,
  finalidade     feature NOT NULL,
  modelo         text NOT NULL,
  tokens_entrada integer NOT NULL DEFAULT 0,
  tokens_saida   integer NOT NULL DEFAULT 0,
  custo_usd      numeric(12,6) NOT NULL DEFAULT 0,
  creditos       integer NOT NULL DEFAULT 0,
  latencia_ms    integer,
  criado_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_uso_ia_org ON uso_ia (org_id, criado_em DESC);

-- =============================================================================
-- 6. Cobrança e réguas
-- =============================================================================

CREATE TABLE regua (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES organizacao(id) ON DELETE CASCADE,
  nome               text NOT NULL,
  descricao          text,
  ativa              boolean NOT NULL DEFAULT true,
  aplicar_a          text NOT NULL DEFAULT 'todas',   -- 'todas' | 'tag'
  tag                text,
  pausar_ao_responder boolean NOT NULL DEFAULT true,
  pausar_ao_pagar    boolean NOT NULL DEFAULT true,
  padrao             boolean NOT NULL DEFAULT false,
  arquivada_em       timestamptz,
  criado_em          timestamptz NOT NULL DEFAULT now(),
  atualizado_em      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_regua_tag CHECK (aplicar_a <> 'tag' OR tag IS NOT NULL)
);
CREATE UNIQUE INDEX ux_regua_padrao ON regua (org_id) WHERE padrao AND arquivada_em IS NULL;

CREATE TABLE regua_etapa (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  regua_id     uuid NOT NULL REFERENCES regua(id) ON DELETE CASCADE,
  ordem        smallint NOT NULL,
  referencia   referencia_etapa NOT NULL DEFAULT 'vencimento',
  offset_dias  smallint NOT NULL DEFAULT 0,      -- negativo = antes
  hora         time NOT NULL DEFAULT '09:00',    -- hora LOCAL (organizacao.fuso)
  condicao     condicao_etapa NOT NULL DEFAULT 'se_nao_pago',
  acao         acao_etapa NOT NULL DEFAULT 'enviar_whatsapp',
  mensagem     text,                             -- usado dentro da janela de 24h
  template_id  uuid REFERENCES template_whatsapp(id) ON DELETE RESTRICT,
  anexar_pix   boolean NOT NULL DEFAULT false,
  ativa        boolean NOT NULL DEFAULT true,
  UNIQUE (regua_id, ordem),
  -- para iniciar conversa fora da janela a Meta exige template aprovado
  CONSTRAINT ck_etapa_conteudo CHECK (
    acao <> 'enviar_whatsapp' OR mensagem IS NOT NULL OR template_id IS NOT NULL
  )
);

CREATE TABLE cobranca (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizacao(id) ON DELETE CASCADE,
  contato_id     uuid NOT NULL REFERENCES contato(id) ON DELETE RESTRICT,
  descricao      text NOT NULL,
  valor          bigint NOT NULL,                -- centavos
  vencimento     date NOT NULL,
  status         status_cobranca NOT NULL DEFAULT 'pendente',
  regua_id       uuid REFERENCES regua(id) ON DELETE SET NULL,
  tags           text[] NOT NULL DEFAULT '{}',
  observacao     text,
  tentativas     smallint NOT NULL DEFAULT 0,
  ultimo_envio_em timestamptz,
  pago_em        timestamptz,
  valor_pago     bigint,
  pagamento_id   uuid REFERENCES pagamento(id) ON DELETE SET NULL,
  origem         origem_registro NOT NULL DEFAULT 'manual',
  externo_id     text,                           -- id no ERP do cliente, p/ importação
  criado_por     uuid REFERENCES usuario(id) ON DELETE SET NULL,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_cobranca_valor CHECK (valor > 0),
  CONSTRAINT ck_cobranca_pago CHECK ((status = 'pago') = (pago_em IS NOT NULL)),
  UNIQUE (org_id, externo_id)
);
CREATE INDEX ix_cobranca_painel ON cobranca (org_id, status, vencimento);
CREATE INDEX ix_cobranca_contato ON cobranca (contato_id, criado_em DESC);

ALTER TABLE pagamento
  ADD CONSTRAINT fk_pagamento_cobranca
  FOREIGN KEY (cobranca_id) REFERENCES cobranca(id) ON DELETE SET NULL;

-- Instância da régua rodando para UMA cobrança
CREATE TABLE regua_execucao (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizacao(id) ON DELETE CASCADE,
  cobranca_id   uuid NOT NULL REFERENCES cobranca(id) ON DELETE CASCADE,
  regua_id      uuid NOT NULL REFERENCES regua(id) ON DELETE RESTRICT,
  status        status_execucao NOT NULL DEFAULT 'ativa',
  motivo_parada text,
  iniciada_em   timestamptz NOT NULL DEFAULT now(),
  encerrada_em  timestamptz
);
-- invariante central: no máximo uma régua ativa por cobrança
CREATE UNIQUE INDEX ux_execucao_ativa ON regua_execucao (cobranca_id) WHERE status = 'ativa';

-- Fila durável: cada linha é um envio futuro concreto (é o que a tela de simulação mostra)
CREATE TABLE disparo (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizacao(id) ON DELETE CASCADE,
  execucao_id   uuid NOT NULL REFERENCES regua_execucao(id) ON DELETE CASCADE,
  etapa_id      uuid NOT NULL REFERENCES regua_etapa(id) ON DELETE CASCADE,
  cobranca_id   uuid NOT NULL REFERENCES cobranca(id) ON DELETE CASCADE,
  executar_em   timestamptz NOT NULL,
  status        status_disparo NOT NULL DEFAULT 'agendado',
  tentativa     smallint NOT NULL DEFAULT 0,
  ultimo_erro   text,
  motivo_ignorado text,
  mensagem_id   uuid REFERENCES mensagem(id) ON DELETE SET NULL,
  processado_em timestamptz,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  -- idempotência estrutural: uma etapa só dispara uma vez por execução
  UNIQUE (execucao_id, etapa_id)
);
-- índice que o worker usa no SKIP LOCKED
CREATE INDEX ix_disparo_fila ON disparo (executar_em) WHERE status = 'agendado';
CREATE INDEX ix_disparo_cobranca ON disparo (cobranca_id, executar_em);

-- Trilha do que aconteceu com a cobrança (alimenta o histórico na UI)
CREATE TABLE cobranca_evento (
  id          bigserial PRIMARY KEY,
  org_id      uuid NOT NULL REFERENCES organizacao(id) ON DELETE CASCADE,
  cobranca_id uuid NOT NULL REFERENCES cobranca(id) ON DELETE CASCADE,
  tipo        text NOT NULL,                     -- criada|enviada|respondeu|pagou|pausou…
  descricao   text,
  dados       jsonb NOT NULL DEFAULT '{}',
  usuario_id  uuid REFERENCES usuario(id) ON DELETE SET NULL,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_cobranca_evento ON cobranca_evento (cobranca_id, criado_em DESC);

-- =============================================================================
-- 7. Agenda
-- =============================================================================

CREATE TABLE servico (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizacao(id) ON DELETE CASCADE,
  nome        text NOT NULL,
  duracao_min smallint NOT NULL DEFAULT 60,
  preco       bigint,
  intervalo_min smallint NOT NULL DEFAULT 0,     -- folga entre atendimentos
  ativo       boolean NOT NULL DEFAULT true,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, nome)
);

CREATE TABLE bloqueio_agenda (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id    uuid NOT NULL REFERENCES organizacao(id) ON DELETE CASCADE,
  motivo    text,
  inicio    timestamptz NOT NULL,
  fim       timestamptz NOT NULL,
  CONSTRAINT ck_bloqueio_intervalo CHECK (fim > inicio)
);

CREATE TABLE agendamento (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizacao(id) ON DELETE CASCADE,
  contato_id  uuid NOT NULL REFERENCES contato(id) ON DELETE RESTRICT,
  servico_id  uuid REFERENCES servico(id) ON DELETE SET NULL,
  conversa_id uuid REFERENCES conversa(id) ON DELETE SET NULL,
  inicio      timestamptz NOT NULL,
  fim         timestamptz NOT NULL,
  status      status_agendamento NOT NULL DEFAULT 'pendente',
  origem      origem_registro NOT NULL DEFAULT 'ia',
  observacao  text,
  lembrete_em timestamptz,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_agendamento_intervalo CHECK (fim > inicio),
  -- impede overbooking no banco (v1: agenda única por organização)
  CONSTRAINT ex_agendamento_sobreposto EXCLUDE USING gist (
    org_id WITH =,
    tstzrange(inicio, fim) WITH &&
  ) WHERE (status IN ('pendente','confirmado'))
);
CREATE INDEX ix_agendamento_periodo ON agendamento (org_id, inicio);

-- =============================================================================
-- 8. Plataforma: webhooks, tarefas, auditoria
-- =============================================================================

CREATE TABLE evento_webhook (
  id          bigserial PRIMARY KEY,
  provedor    text NOT NULL,                     -- 'meta' | 'mercadopago'
  evento_id   text NOT NULL,
  tipo        text,
  org_id      uuid REFERENCES organizacao(id) ON DELETE SET NULL,
  payload     jsonb NOT NULL,
  processado_em timestamptz,
  tentativas  smallint NOT NULL DEFAULT 0,
  erro        text,
  recebido_em timestamptz NOT NULL DEFAULT now(),
  -- reentrega do provedor não pode gerar efeito duplicado
  UNIQUE (provedor, evento_id)
);
CREATE INDEX ix_webhook_pendente ON evento_webhook (recebido_em) WHERE processado_em IS NULL;

CREATE TABLE tarefa (                             -- fila genérica dos workers
  id           bigserial PRIMARY KEY,
  org_id       uuid REFERENCES organizacao(id) ON DELETE CASCADE,
  tipo         text NOT NULL,                    -- 'responder_ia' | 'sync_template' | …
  payload      jsonb NOT NULL DEFAULT '{}',
  executar_em  timestamptz NOT NULL DEFAULT now(),
  status       status_disparo NOT NULL DEFAULT 'agendado',
  tentativa    smallint NOT NULL DEFAULT 0,
  ultimo_erro  text,
  chave_unica  text UNIQUE,                      -- opcional: deduplicação
  criado_em    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_tarefa_fila ON tarefa (executar_em) WHERE status = 'agendado';

CREATE TABLE log_auditoria (
  id         bigserial PRIMARY KEY,
  org_id     uuid REFERENCES organizacao(id) ON DELETE CASCADE,
  usuario_id uuid REFERENCES usuario(id) ON DELETE SET NULL,
  acao       text NOT NULL,
  entidade   text NOT NULL,
  entidade_id text,
  dados      jsonb NOT NULL DEFAULT '{}',
  ip         inet,
  criado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_auditoria_org ON log_auditoria (org_id, criado_em DESC);

-- =============================================================================
-- 9. Views de apoio
-- =============================================================================

CREATE VIEW v_saldo_credito AS
  SELECT org_id,
         SUM(quantidade)::bigint AS saldo,
         SUM(quantidade) FILTER (WHERE quantidade > 0)::bigint AS total_creditado,
         -SUM(quantidade) FILTER (WHERE quantidade < 0)::bigint AS total_consumido
    FROM movimento_credito
   GROUP BY org_id;

-- Atenção: envios e valores são agregados em subconsultas separadas.
-- Um JOIN único entre `disparo` e `cobranca` multiplicaria o valor recuperado
-- pelo número de disparos da cobrança.
CREATE VIEW v_regua_stats AS
  SELECT r.id     AS regua_id,
         r.org_id,
         COALESCE(env.enviadas, 0)   AS enviadas,
         COALESCE(env.ignoradas, 0)  AS ignoradas,
         COALESCE(rec.recuperado, 0) AS recuperado,
         COALESCE(rec.cobrancas_pagas, 0) AS cobrancas_pagas
    FROM regua r
    LEFT JOIN (
      SELECT e.regua_id,
             COUNT(*) FILTER (WHERE d.status = 'enviado')  AS enviadas,
             COUNT(*) FILTER (WHERE d.status = 'ignorado') AS ignoradas
        FROM regua_execucao e
        JOIN disparo d ON d.execucao_id = e.id
       GROUP BY e.regua_id
    ) env ON env.regua_id = r.id
    LEFT JOIN (
      SELECT e.regua_id,
             SUM(c.valor)::bigint AS recuperado,
             COUNT(*)             AS cobrancas_pagas
        FROM regua_execucao e
        JOIN cobranca c ON c.id = e.cobranca_id AND c.status = 'pago'
       GROUP BY e.regua_id
    ) rec ON rec.regua_id = r.id;

-- =============================================================================
-- 10. Triggers
-- =============================================================================

CREATE TRIGGER tg_usuario_upd      BEFORE UPDATE ON usuario      FOR EACH ROW EXECUTE FUNCTION tg_atualizado_em();
CREATE TRIGGER tg_org_upd          BEFORE UPDATE ON organizacao  FOR EACH ROW EXECUTE FUNCTION tg_atualizado_em();
CREATE TRIGGER tg_assinatura_upd   BEFORE UPDATE ON assinatura   FOR EACH ROW EXECUTE FUNCTION tg_atualizado_em();
CREATE TRIGGER tg_pagamento_upd    BEFORE UPDATE ON pagamento    FOR EACH ROW EXECUTE FUNCTION tg_atualizado_em();
CREATE TRIGGER tg_canal_upd        BEFORE UPDATE ON canal_whatsapp FOR EACH ROW EXECUTE FUNCTION tg_atualizado_em();
CREATE TRIGGER tg_template_upd     BEFORE UPDATE ON template_whatsapp FOR EACH ROW EXECUTE FUNCTION tg_atualizado_em();
CREATE TRIGGER tg_contato_upd      BEFORE UPDATE ON contato      FOR EACH ROW EXECUTE FUNCTION tg_atualizado_em();
CREATE TRIGGER tg_regua_upd        BEFORE UPDATE ON regua        FOR EACH ROW EXECUTE FUNCTION tg_atualizado_em();
CREATE TRIGGER tg_cobranca_upd     BEFORE UPDATE ON cobranca     FOR EACH ROW EXECUTE FUNCTION tg_atualizado_em();
CREATE TRIGGER tg_agendamento_upd  BEFORE UPDATE ON agendamento  FOR EACH ROW EXECUTE FUNCTION tg_atualizado_em();
CREATE TRIGGER tg_integracao_upd   BEFORE UPDATE ON integracao_mp FOR EACH ROW EXECUTE FUNCTION tg_atualizado_em();

-- Mantém organizacao.saldo_creditos coerente com o ledger, na mesma transação.
CREATE FUNCTION tg_aplicar_credito() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  novo_saldo bigint;
BEGIN
  UPDATE organizacao
     SET saldo_creditos = saldo_creditos + NEW.quantidade
   WHERE id = NEW.org_id
  RETURNING saldo_creditos INTO novo_saldo;

  IF novo_saldo < 0 THEN
    RAISE EXCEPTION 'saldo de créditos insuficiente para a organização %', NEW.org_id
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.saldo_apos := novo_saldo;
  RETURN NEW;
END $$;

CREATE TRIGGER tg_movimento_credito
  BEFORE INSERT ON movimento_credito
  FOR EACH ROW EXECUTE FUNCTION tg_aplicar_credito();

-- =============================================================================
-- 11. Row Level Security (defesa em profundidade)
--     A aplicação executa:  SET LOCAL app.org_id = '<uuid>';
--     Workers usam um papel BYPASSRLS.
-- =============================================================================

CREATE FUNCTION app_org() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.org_id', true), '')::uuid
$$;

-- Ficam FORA da RLS de propósito:
--   membro, convite      → lidos no login, ANTES de existir um org_id no contexto
--   evento_webhook       → chega sem tenant resolvido (o payload é que revela a org)
--   tarefa, log_auditoria→ tabelas de plataforma, acessadas só por worker/admin
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'org_id'
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND c.relname NOT IN ('membro','convite','evento_webhook','tarefa','log_auditoria')
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY isolamento_tenant ON %I USING (org_id = app_org()) WITH CHECK (org_id = app_org())',
      t
    );
  END LOOP;
END $$;

COMMIT;
