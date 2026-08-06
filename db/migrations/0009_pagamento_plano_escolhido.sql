-- Ao contratar ou trocar de plano, o pagamento fica pendente enquanto o
-- cliente paga o PIX no Mercado Pago. Quando o webhook confirma, o worker
-- precisa saber QUAL plano/periodicidade o cliente escolheu para atualizar
-- a assinatura — mas `assinatura.plano_id` nesse momento ainda é o plano
-- ANTIGO (só trocamos depois da confirmação), então não dá pra descobrir a
-- escolha através da assinatura. Guardamos a escolha no próprio pagamento.
ALTER TABLE pagamento
  ADD COLUMN plano_id      text REFERENCES plano(id),
  ADD COLUMN periodicidade periodicidade;
