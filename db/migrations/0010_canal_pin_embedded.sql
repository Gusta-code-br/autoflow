-- 0010_canal_pin_embedded.sql — WhatsApp Embedded Signup
--
-- O fluxo automático (Embedded Signup da Meta) registra o número na Cloud API
-- chamando `/register` com um PIN de verificação em duas etapas que a gente
-- mesmo gera. Se a Meta um dia pedir re-registro (número migrou de app,
-- sessão da Cloud API caiu), é o MESMO PIN que a chamada precisa mandar de
-- novo — perdê-lo significa não conseguir reativar o número sem o cliente
-- entrar no Business Manager. Por isso ele é persistido, cifrado como o
-- token, não descartado depois do primeiro uso.
ALTER TABLE canal_whatsapp
  ADD COLUMN pin_cif text;
