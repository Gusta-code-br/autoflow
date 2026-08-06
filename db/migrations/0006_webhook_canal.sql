-- 0006 — Autenticação do webhook por canal (provedores não-oficiais)
--
-- A Cloud API assina o corpo com o app_secret, então o webhook da Meta se
-- verifica sozinho. A Evolution não assina nada: o máximo possível é dar a
-- cada instância uma URL com segredo próprio. Guardamos só o HMAC do token
-- (mesma função de sessão/convite) — vazamento do banco não devolve a URL.

ALTER TABLE canal_whatsapp
  ADD COLUMN webhook_token_hash text;

-- Único para que o lookup por hash resolva um canal e só um.
CREATE UNIQUE INDEX ux_canal_webhook_token
    ON canal_whatsapp (webhook_token_hash)
 WHERE webhook_token_hash IS NOT NULL;

-- Ordem dos status de mensagem, para que o webhook nunca regrida a linha.
--
-- A Meta manda `delivered` e `read` fora de ordem com frequência, e reentrega
-- eventos antigos depois de instabilidade. Sem essa comparação, um `sent`
-- atrasado apaga o "lida às 14h" que o dono já viu na tela.
--
-- 'falhou' entra entre 'enviada' e 'entregue' de propósito: uma falha reportada
-- depois do envio deve aparecer, mas nunca sobrescrever uma entrega/leitura
-- confirmada (aí o erro é do relatório, não da mensagem).
CREATE FUNCTION ordem_status(s status_mensagem) RETURNS smallint
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE s
           WHEN 'pendente' THEN 0
           WHEN 'enviada'  THEN 1
           WHEN 'falhou'   THEN 2
           WHEN 'entregue' THEN 3
           WHEN 'lida'     THEN 4
         END::smallint
$$;

-- O webhook chega sem sessão e precisa achar o canal pelo phone_number_id
-- (Meta) antes de saber a organização. phone_number_id já é UNIQUE; aqui só
-- garantimos o caminho de leitura por instância da Evolution.
CREATE INDEX ix_canal_instancia
    ON canal_whatsapp (instancia)
 WHERE instancia IS NOT NULL;
