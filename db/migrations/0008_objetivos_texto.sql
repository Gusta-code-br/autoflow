-- `organizacao.objetivos` guarda os OBJETIVOS escolhidos no onboarding
-- ("responder", "agendar", "cobrar", "qualificar", "orcamento", "pos-venda" —
-- ver src/app/onboarding/form.tsx). Isso é um conceito diferente do enum
-- `feature` ("atendimento"/"cobranca"/"agendamento"), que descreve o que um
-- PLANO paga (pacote_credito.features, cobranca_evento.finalidade). A coluna
-- foi criada com o tipo errado (feature[]) em 0001_init.sql: qualquer
-- objetivo fora dos 3 valores do enum — ou seja, a maioria — quebrava o
-- INSERT com "invalid input value for enum feature", derrubando a conclusão
-- do onboarding (100% reprodutível com os checkboxes padrão do formulário).
ALTER TABLE organizacao
  ALTER COLUMN objetivos TYPE text[] USING objetivos::text[];
