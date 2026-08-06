-- =============================================================================
-- 0005 — marca do momento da reserva no worker de disparos
--
-- `criado_em` não serve para detectar disparo travado: uma linha criada há três
-- dias e reservada agora seria "recuperada" no mesmo instante, saindo duas
-- vezes. `reservado_em` guarda quando o worker pegou a linha.
-- =============================================================================

ALTER TABLE disparo ADD COLUMN reservado_em timestamptz;

CREATE INDEX ix_disparo_travado ON disparo (reservado_em)
  WHERE status = 'processando';
