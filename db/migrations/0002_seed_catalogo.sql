-- =============================================================================
-- Seed do catálogo comercial — espelha src/lib/plans.ts (que passa a ser só a
-- fonte para a landing estática).  Idempotente: pode rodar em todo deploy.
-- Valores em CENTAVOS.
-- =============================================================================

BEGIN;

INSERT INTO plano (id, nome, chamada, ordem, preco_mensal, features, creditos_mes, conexoes_inclusas, destaque, beneficios) VALUES
  ('essencial', 'Essencial', 'Para quem só quer parar de perder mensagem.', 1, 9700,
   '{atendimento}', 1000, 1, false,
   '["IA de atendimento 24/7 no WhatsApp","1 número de WhatsApp conectado","1.000 mensagens de IA por mês","Painel de conversas e histórico","Assumir a conversa quando quiser"]'),

  ('profissional', 'Profissional', 'Atende e ainda corre atrás do dinheiro por você.', 2, 19700,
   '{atendimento,cobranca}', 3000, 1, true,
   '["Tudo do Essencial","Réguas de cobrança automáticas ilimitadas","PIX automático dentro da mensagem","3.000 mensagens de IA por mês","Relatório de recuperação de inadimplência"]'),

  ('completo', 'Completo', 'Atendimento, cobrança e agenda no automático.', 3, 34700,
   '{atendimento,cobranca,agendamento}', 10000, 2, false,
   '["Tudo do Profissional","Agendamento pela IA direto no WhatsApp","Aviso no seu WhatsApp pessoal a cada novo agendamento","2 números de WhatsApp inclusos","10.000 mensagens de IA por mês"]')
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome, chamada = EXCLUDED.chamada, ordem = EXCLUDED.ordem,
  preco_mensal = EXCLUDED.preco_mensal, features = EXCLUDED.features,
  creditos_mes = EXCLUDED.creditos_mes, conexoes_inclusas = EXCLUDED.conexoes_inclusas,
  destaque = EXCLUDED.destaque, beneficios = EXCLUDED.beneficios;

-- desconto_bp: 0 / 1500 (15%) / 2500 (25%) — preco_total já com desconto aplicado
INSERT INTO plano_preco (plano_id, periodicidade, meses, desconto_bp, preco_total) VALUES
  ('essencial',    'mensal',     1,    0,   9700),
  ('essencial',    'semestral',  6, 1500,  49470),
  ('essencial',    'anual',     12, 2500,  87300),
  ('profissional', 'mensal',     1,    0,  19700),
  ('profissional', 'semestral',  6, 1500, 100470),
  ('profissional', 'anual',     12, 2500, 177300),
  ('completo',     'mensal',     1,    0,  34700),
  ('completo',     'semestral',  6, 1500, 176970),
  ('completo',     'anual',     12, 2500, 312300)
ON CONFLICT (plano_id, periodicidade) DO UPDATE SET
  meses = EXCLUDED.meses, desconto_bp = EXCLUDED.desconto_bp, preco_total = EXCLUDED.preco_total;

INSERT INTO pacote_credito (id, creditos, preco, selo) VALUES
  ('pac-1k',   1000,  3900, NULL),
  ('pac-5k',   5000, 16900, 'Mais vendido'),
  ('pac-15k', 15000, 44900, 'Melhor custo')
ON CONFLICT (id) DO UPDATE SET
  creditos = EXCLUDED.creditos, preco = EXCLUDED.preco, selo = EXCLUDED.selo;

INSERT INTO parametro (chave, valor) VALUES
  ('preco_conexao_extra',   '4900'),
  ('trial_dias',            '7'),
  ('taxa_plataforma_bp',    '99'),      -- 0,99% sobre PIX do cliente final
  ('creditos_por_mensagem', '1'),
  ('retencao_mensagens_dias', '365')
ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now();

COMMIT;
