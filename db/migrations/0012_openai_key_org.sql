-- =============================================================================
-- 0012 — cada organização usa a própria chave da OpenAI
--
-- Até aqui a IA rodava com uma única chave global em OPENAI_API_KEY: o
-- AutoFlow pagava o consumo de todo mundo e cobrava de volta via
-- `movimento_credito` (1 crédito por mensagem). Isso não escala — o cliente
-- que manda muita mensagem paga caro na OpenAI por conta do AutoFlow — e
-- trava o produto a uma única conta da OpenAI.
--
-- A partir de agora o cliente informa a própria chave na configuração da IA;
-- o worker chama a OpenAI com ela e quem paga o consumo é o dono da chave.
-- Sem chave própria configurada, a IA simplesmente não roda para aquela
-- organização (nada de fallback silencioso para uma chave compartilhada).
--
-- Segue o mesmo padrão de `canal_whatsapp.token_cif` / `integracao_mp.*_cif`:
-- AES-256-GCM em `seguranca/cripto.ts`, versão da chave ao lado para permitir
-- rotação sem reescrever tudo de uma vez. AAD = `openai:<org_id>`.
-- =============================================================================

ALTER TABLE organizacao
  ADD COLUMN openai_api_key_cif text,
  ADD COLUMN openai_chave_versao smallint;
