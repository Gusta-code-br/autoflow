# AutoFlow — Plano de execução

> Ordem escolhida por **risco**, não por conforto. O que pode travar o lançamento por
> motivo externo entra primeiro.

---

## Fase 0 — Destravar o que não depende de você (comece hoje, roda em paralelo)

Estes itens têm fila de terceiro e são o caminho crítico real:

1. **Verificação do Meta Business** — Business Manager, verificação da empresa (CNPJ,
   comprovante), app no Meta for Developers, WhatsApp Business Account, número dedicado.
   *Leva de dias a semanas e pode ser rejeitado.* Enquanto isso, use o número de teste
   da Meta, que só envia para 5 destinatários cadastrados.
2. **Aplicação OAuth no Mercado Pago** — credenciais de produção, `redirect_uri`,
   homologação do fluxo de marketplace.
3. **Primeiros templates em análise** — `cobranca_lembrete_previo`,
   `cobranca_vencimento_hoje`, `cobranca_atraso`, `agendamento_confirmacao`,
   `agendamento_lembrete`. Aprovação leva de minutos a 48h e **rejeição é comum**
   (evite tom de spam, promessa e excesso de variável).

> Se começar pelo código e deixar isso para o fim, o produto fica pronto e parado.

---

## Fase 1 — Fundação (dados + auth)

- [ ] Provisionar Neon; branch `main` + branch de preview por PR
- [ ] Rodar `0001_init.sql` e `0002_seed_catalogo.sql`
- [ ] Escolher acesso: **Drizzle** (`drizzle-kit introspect` em cima do DDL existente —
      o SQL continua sendo a fonte da verdade) ou `postgres.js` puro + tipos à mão
- [ ] `src/server/dal/contexto.ts`: `getSessao()` com `cache()`, `exigirSessao()`,
      `exigirFeature()`
- [ ] Auth.js v5: e-mail/senha (Argon2id) + magic link; tabela `sessao`
- [ ] Middleware de transação que aplica `SET LOCAL app.org_id`
- [ ] Migrar o onboarding (5 passos, hoje em `localStorage`) para gravar em
      `organizacao` + `membro`

**Pronto quando:** dá para criar conta, logar, completar onboarding e o dado sobrevive
a um F5 em outro navegador.

## Fase 2 — Cobrança sem envio real

- [ ] CRUD de `contato` com normalização E.164 (uma função, testada, usada em todo lugar)
- [ ] CRUD de `cobranca` (valores em centavos)
- [ ] Builder de régua gravando `regua` + `regua_etapa`
- [ ] `src/server/dominio/regua.ts`: `materializarDisparos()` — puro, testável, com
      conversão de fuso; `avaliarCondicao()`
- [ ] Tela "próximos disparos" lendo `disparo` de verdade (era simulação)
- [ ] Testes de tabela: virada de horário de verão, offset negativo, etapa às 23h,
      cobrança criada depois do vencimento

**Pronto quando:** criar cobrança gera as linhas certas em `disparo`, e pagar cancela
as pendentes na mesma transação.

## Fase 3 — Workers e WhatsApp

- [ ] Serviço `worker` no Railway (mesmo repo, `apps/worker` ou script `tsx`)
- [ ] Loop `FOR UPDATE SKIP LOCKED` com backoff exponencial e limite por número
- [ ] Cliente da Cloud API: envio de template e de texto livre, tratamento dos códigos
      131047 (fora da janela), 131026 (número inválido), 130429 (rate limit)
- [ ] Webhook `/api/webhooks/whatsapp`: verificação de assinatura → grava
      `evento_webhook` → 200 imediato → processa por `tarefa`
- [ ] Atualizar `conversa.janela_expira_em` a cada mensagem recebida
- [ ] Status de entrega (`sent`/`delivered`/`read`) em `mensagem`
- [ ] Pausa automática (respondeu / pagou) + opt-out por "PARAR"

**Pronto quando:** uma cobrança de teste percorre a régua inteira sozinha, com log.

## Fase 4 — Dinheiro

- [ ] Checkout da assinatura (preapproval MP) + webhook + `assinatura`
- [ ] Compra de crédito e conexão extra → `movimento_credito`
- [ ] OAuth do MP por tenant → `integracao_mp` (tokens cifrados, refresh agendado)
- [ ] PIX da cobrança com `application_fee`; QR na mensagem
- [ ] Baixa automática: webhook `payment.updated` → `cobranca.status='pago'` →
      cancela disparos → notifica o dono
- [ ] Régua de inadimplência da **sua** assinatura (dogfooding)

**Pronto quando:** o dinheiro entra sozinho e o webhook duplicado não credita duas vezes.

## Fase 5 — IA de atendimento

- [ ] Worker de resposta: contexto = perfil da org + histórico + cobranças em aberto +
      agenda disponível
- [ ] Tool calling: `consultar_cobrancas`, `gerar_pix`, `agendar`, `escalar_humano`
- [ ] Débito de crédito **antes** da chamada (reserva) e registro em `uso_ia`
- [ ] Guardrails: nunca inventar valor/data; sem saldo → não responde e avisa o dono;
      fora do expediente → resposta de espera
- [ ] Handoff IA→humano trocando `conversa.modo`

## Fase 6 — Agenda e lançamento

- [ ] `servico`, disponibilidade, `agendamento` via IA (o `EXCLUDE` protege de choque)
- [ ] Lembretes por template
- [ ] Observabilidade: Sentry, alerta de fila parada, painel de margem por cliente
      (`uso_ia.custo_usd` × receita)
- [ ] Runbook: número banido, template rejeitado, MP fora do ar, fila travada

---

## Variáveis de ambiente

```bash
# banco
DATABASE_URL=                 # Neon pooled (app)
DATABASE_URL_DIRETA=          # Neon direto (workers + migrations)

# auth / cripto
AUTH_SECRET=
CRYPTO_KEY=                   # 32 bytes base64 — cifra tokens de terceiros
CRYPTO_KEY_VERSAO=1

# meta cloud api
META_APP_ID=
META_APP_SECRET=
META_VERIFY_TOKEN=            # handshake do webhook
META_API_VERSION=v21.0

# mercado pago
MP_ACCESS_TOKEN=              # sua conta (assinaturas)
MP_CLIENT_ID=                 # OAuth marketplace
MP_CLIENT_SECRET=
MP_WEBHOOK_SECRET=

# ia
ANTHROPIC_API_KEY=
IA_MODELO=claude-sonnet-5
```

---

## Riscos e mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| Verificação da Meta demora/rejeita | Bloqueia lançamento | Fase 0 já; ter plano B com número de teste para demo |
| Template rejeitado | Régua não envia | Cadastrar variantes; `status_template` visível na UI com aviso |
| Número banido por denúncia | Cliente perde o canal | Opt-out fácil, throttling, categoria UTILITY, monitorar `qualidade` |
| Custo de IA maior que a margem | Prejuízo silencioso | `uso_ia.custo_usd` por org desde o dia 1; alerta de margem |
| Webhook duplicado | Baixa/crédito em dobro | `UNIQUE (provedor, evento_id)` + idempotência no ledger |
| Fuso/horário de verão | Mensagem de madrugada | Hora local + `fuso` da org, com teste de tabela |

---

## Primeiro passo concreto

```bash
# 1. criar o projeto no Neon e exportar a URL
psql "$DATABASE_URL_DIRETA" -f db/migrations/0001_init.sql
psql "$DATABASE_URL_DIRETA" -f db/migrations/0002_seed_catalogo.sql

# 2. conferir
psql "$DATABASE_URL_DIRETA" -c "\dt"
psql "$DATABASE_URL_DIRETA" -c "SELECT id, preco_mensal, creditos_mes FROM plano ORDER BY ordem;"
```

Em paralelo, abrir o Business Manager da Meta. **Hoje.**
