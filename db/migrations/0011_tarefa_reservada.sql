-- =============================================================================
-- 0011 — marca do momento da reserva na fila genérica de tarefas
--
-- Mesma lógica de 0005 para `disparo`: sem isso, uma tarefa travada no worker
-- (deploy no meio do lote, OOM) nunca é detectada.
-- =============================================================================

ALTER TABLE tarefa ADD COLUMN reservado_em timestamptz;

CREATE INDEX ix_tarefa_travada ON tarefa (reservado_em)
  WHERE status = 'processando';
