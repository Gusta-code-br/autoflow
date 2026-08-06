-- 0004_canal_credenciais.sql — ajustes descobertos ao ligar o canal de verdade
--
-- 1) `token_cif` era bytea. A função `cifrar()` devolve um envelope em texto
--    ("v1.iv.tag.ct" em base64url) porque ele precisa carregar a versão da
--    chave junto: sem isso, rotacionar chave viraria migração de dados. Guardar
--    esse envelope como bytea só adicionava encode/decode em toda leitura.
--
-- 2) A Evolution API não usa phone_number_id: ela precisa da URL da instância e
--    do nome dela. Sem essas colunas, o único provedor possível era o oficial —
--    que é justamente o que o cliente pequeno não tem no primeiro dia.
--
-- 3) `ultimo_erro` para a tela de canais mostrar por que parou de enviar.

ALTER TABLE canal_whatsapp
  ALTER COLUMN token_cif TYPE text USING convert_from(token_cif, 'UTF8'),
  ADD COLUMN base_url    text,
  ADD COLUMN instancia   text,
  ADD COLUMN ultimo_erro text;

ALTER TABLE integracao_mp
  ALTER COLUMN access_token_cif  TYPE text USING convert_from(access_token_cif, 'UTF8'),
  ALTER COLUMN refresh_token_cif TYPE text USING convert_from(refresh_token_cif, 'UTF8');

-- Um canal conectado precisa das credenciais do seu provedor. Deixar isso no
-- banco evita o pior caso: canal salvo pela metade que só falha na hora do
-- disparo, de madrugada, sem ninguém olhando.
ALTER TABLE canal_whatsapp
  ADD CONSTRAINT ck_canal_credenciais CHECK (
    status <> 'conectado'
    OR (
      token_cif IS NOT NULL
      AND (
        (provedor = 'meta_cloud' AND phone_number_id IS NOT NULL)
        OR (provedor = 'evolution' AND base_url IS NOT NULL AND instancia IS NOT NULL)
      )
    )
  );

-- Nota: `ux_canal_principal` (um canal principal por organização) já nasce em
-- 0001_init.sql. Recriar aqui quebraria a migração — a fábrica depende dele
-- porque o worker escolhe o canal por `ORDER BY principal DESC` e um empate
-- significaria mandar mensagem pelo número errado de forma não determinística.
