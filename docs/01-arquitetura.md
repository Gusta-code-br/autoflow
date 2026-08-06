# AutoFlow — Arquitetura de produção

> Documento vivo. Decisões tomadas em 2026-07-31 para sair do protótipo navegável
> (`src/lib/mock-data.ts` + estado em `localStorage`) para um SaaS multi-tenant real.

---

## 1. Topologia

```
                    ┌──────────────────────────────────────────┐
   navegador ─────► │ Vercel — Next.js 16 (App Router)         │
                    │  • UI + Data Access Layer (server-only)  │
                    │  • Route Handlers: webhooks              │
                    └───────────┬──────────────────────────────┘
                                │ SQL (TLS, pooled)
                    ┌───────────▼──────────────────────────────┐
                    │ Neon — Postgres serverless               │
                    │  • dado transacional + fila `disparo`    │
                    │  • branch de preview por PR              │
                    └───────────▲──────────────────────────────┘
                                │ SQL (conexão direta, long-lived)
                    ┌───────────┴──────────────────────────────┐
                    │ Railway — workers Node (sempre ligados)  │
                    │  • agendador (tick de 60s)               │
                    │  • executor de disparos                  │
                    │  • executor de IA (fila de resposta)     │
                    └───────────┬──────────────────────────────┘
                                │ HTTPS
        ┌───────────────────────┼────────────────────────┐
        ▼                       ▼                        ▼
  Meta Cloud API         Mercado Pago              Anthropic / OpenAI
  (WhatsApp Business)    (assinatura + PIX)        (IA de atendimento)
```

### Por que essa divisão

| Peça | Responsabilidade | Por que não no outro lugar |
|---|---|---|
| **Vercel** | Renderizar painel, mutações do usuário, receber webhooks | Função serverless morre em segundos: não serve para cron de precisão nem para conexão longa |
| **Neon** | Verdade única. Inclui a fila de disparos | Fila em Redis separado criaria dois pontos de verdade e perda de atomicidade com a cobrança |
| **Railway** | Processos longos, retentativa, throttling por número | Vercel Cron tem granularidade e timeout ruins para milhares de disparos/minuto |

> **Regra de ouro:** a Vercel *nunca* fala com Meta/Mercado Pago para enviar coisa em
> lote. Ela só escreve intenção no banco (`disparo`, `tarefa`); quem executa é o
> worker. Isso dá retentativa, idempotência e rate-limit num lugar só.

---

## 2. Camadas dentro do Next

Seguindo o guia oficial (`node_modules/next/dist/docs/01-app/02-guides/data-security.md`),
o projeto adota **Data Access Layer** — não acesso a banco solto dentro de componente.

```
src/
  app/                     # rotas: só compõem UI e chamam a DAL
  server/
    dal/                   # 'server-only' — TODA query passa por aqui
      contexto.ts          #   cache(getSessao) → { usuarioId, orgId, plano }
      cobrancas.ts         #   listarCobrancas(): sempre filtra por orgId do contexto
      ...
    dominio/               # regras puras, testáveis, sem I/O
      regua.ts             #   calcularDisparos(), avaliarCondicao()
      creditos.ts          #   custoEmCreditos(tokens, modelo)
    integracoes/           # clientes HTTP: meta.ts, mercadopago.ts, ia.ts
  db/
    schema.ts              # tipos gerados do banco
```

Três regras não negociáveis:

1. **Nenhuma função da DAL aceita `orgId` como parâmetro.** Ela lê da sessão via
   `cache()`. Parâmetro é convite para IDOR — basta um `orgId` vindo do cliente.
2. Toda função da DAL começa com `await exigirSessao()` e, quando o recurso é pago,
   `exigirFeature("cobranca")`. Autorização na borda do dado, não na borda da rota.
3. A DAL devolve **DTO**, nunca a linha crua. Token de WhatsApp e `access_token` do
   Mercado Pago jamais atravessam a fronteira servidor→cliente.

Defesa em profundidade: além da DAL, o banco tem **RLS ligada** em toda tabela com
`org_id` (ver `db/migrations/0001_init.sql`, seção 12). A app seta
`SET LOCAL app.org_id` por transação. Se um `WHERE` for esquecido, o banco corta.

---

## 3. Fluxos críticos

### 3.1 Régua de cobrança (o coração do produto)

```
cobranca criada ──► regua_execucao (1 ativa por cobrança)
                        │
                        └─► materializa N linhas em `disparo`
                              (executar_em = data-base ± offset, na hora local da org)

worker agendador (a cada 60s):
  SELECT ... FROM disparo
   WHERE status='agendado' AND executar_em <= now()
   ORDER BY executar_em
   FOR UPDATE SKIP LOCKED LIMIT 200      ← concorrência segura, sem Redis

  para cada disparo:
    reavalia condição (se_nao_pago / se_sem_resposta) contra o estado ATUAL
      ├─ não bate  → status='ignorado' (registra motivo)
      └─ bate      → debita crédito → envia via Meta → status='enviado'
```

**Por que materializar os disparos em vez de calcular na hora:**
dá para mostrar ao usuário "o que vai acontecer e quando" (a tela de simulação do
protótipo vira dado real), dá para cancelar cirurgicamente quando o cliente paga, e o
`UNIQUE (execucao_id, etapa_id)` transforma idempotência em invariante de banco — o
worker pode crashar no meio que não duplica mensagem.

**Pausa automática:** quando chega webhook de mensagem do contato (`pausar_ao_responder`)
ou de pagamento (`pausar_ao_pagar`), a execução vira `pausada`/`concluida` e todos os
disparos `agendado` daquela execução viram `cancelado` na mesma transação.

### 3.2 Janela de 24h — a maior mudança vinda da Cloud API

O protótipo assume texto livre. A API oficial **não permite**: fora de uma janela de
24h desde a última mensagem do contato, só se inicia conversa com **template aprovado**
pela Meta (categoria `UTILITY` para cobrança/lembrete; `MARKETING` custa mais e tem
mais bloqueio).

Consequências no modelo:

- `conversa.janela_expira_em` — atualizado a cada mensagem *recebida*.
- `regua_etapa.template_id` — obrigatório quando a etapa inicia conversa; o texto livre
  vira `mensagem` só para etapas dentro da janela.
- Tabela `template_whatsapp` com ciclo `rascunho → em_analise → aprovado/rejeitado`,
  sincronizada por webhook `message_template_status_update`.
- No builder, as variáveis `{{nome}}`, `{{valor}}` deixam de ser texto e viram
  **mapeamento posicional** (`variaveis_map`), porque a Meta numera: `{{1}}`, `{{2}}`.

> Sem isso o produto quebra em produção no primeiro dia. Vale desenhar o builder já
> sabendo que o corpo do template é imutável depois de aprovado — editar = criar versão.

### 3.3 Dinheiro

Dois fluxos distintos, **mesmo gateway**:

| | Assinatura do AutoFlow | Cobrança do cliente final |
|---|---|---|
| Quem recebe | Você | O usuário (dono da conta) |
| Credencial | Sua conta MP (env) | `integracao_mp` do tenant, via **OAuth** |
| Objeto MP | `preapproval` (recorrente) ou `payment` PIX | `payment` PIX com `application_fee` |
| Tabela | `assinatura` + `pagamento` | `pagamento` (com `cobranca_id`) |

O OAuth do Mercado Pago é o que permite emitir o PIX **em nome do usuário** e ainda
reter sua taxa (`application_fee`) — é o que transforma a baixa automática em receita
recorrente adicional, além da mensalidade.

`refresh_token` e `access_token` ficam cifrados (AES-256-GCM, chave em env, ver §5).

**Webhook de pagamento** (`/api/webhooks/mercadopago`): grava cru em `evento_webhook`
com `UNIQUE (provedor, evento_id)` → responde 200 na hora → enfileira processamento.
Mercado Pago reenvia evento; sem essa unicidade você dá baixa duas vezes e credita
crédito em dobro.

### 3.4 Créditos de IA

Ledger append-only (`movimento_credito`), nunca um `UPDATE saldo = saldo - 1`:

```
compra       +5000   origem: pagamento#123
bonus_plano  +2000   origem: assinatura#7   (expira no fim do ciclo)
consumo         -3   origem: uso_ia#998     (idempotencia: mensagem_id)
```

Saldo é `SUM(quantidade)` (view `v_saldo_credito`, com coluna-cache em
`organizacao.saldo_creditos` mantida na mesma transação). Motivos: auditoria completa
("por que sumiu meu crédito?"), estorno trivial, e créditos de plano expirando sem
derrubar os comprados.

Conversão sugerida: **1 crédito ≈ 1 mensagem processada pela IA**, precificado com
margem sobre o custo real de tokens (guardado em `uso_ia.custo_usd` para você medir a
margem de verdade por cliente).

---

## 4. Autenticação

- **Auth.js v5** com adapter Postgres, sessão em cookie httpOnly + tabela `sessao`.
- Login por e-mail/senha (Argon2id) + magic link. OAuth Google depois.
- `membro` liga usuário↔organização com papel (`dono`, `atendente`) — necessário porque
  a inbox tem modo humano e clínicas têm recepcionista.
- Toda request resolve `contexto` uma vez via `cache()` e reusa na árvore inteira.

---

## 5. Segredos e conformidade

| Dado | Tratamento |
|---|---|
| Token da Cloud API, tokens MP | Cifrados na aplicação (AES-256-GCM), coluna `bytea`. Chave em `CRYPTO_KEY`, rotacionável via `chave_versao` |
| Senha | Argon2id |
| Telefone do contato | Dado pessoal (LGPD). `contato.opt_out_em` respeitado por **toda** régua |
| Mensagens | Retenção configurável; job de expurgo por org |
| Webhook | Assinatura verificada (`X-Hub-Signature-256` na Meta; `x-signature` no MP) antes de qualquer parse |

**Opt-out não é opcional:** cobrança automatizada sem saída fácil é o caminho mais
rápido para denúncia e bloqueio do número. O worker checa `contato.bloqueado` e
`opt_out_em` antes de cada envio, e "PARAR/SAIR" na resposta marca opt-out.

---

## 6. Ambientes

| | Banco | App | Workers |
|---|---|---|---|
| local | Neon branch `dev` (ou Postgres em Docker) | `next dev` | `tsx watch` |
| preview | branch Neon por PR (efêmero) | preview Vercel | não sobe |
| prod | branch `main` do Neon | Vercel prod | Railway |

Migrations versionadas em `db/migrations/`, aplicadas por CI antes do deploy.
Sempre compatíveis com a versão anterior (expand → migrate → contract), porque a Vercel
faz rollout gradual e worker antigo e novo convivem por alguns minutos.

---

## 7. ADRs (decisões e o que foi descartado)

**ADR-001 — Fila no Postgres, não Redis/BullMQ.**
`FOR UPDATE SKIP LOCKED` aguenta com folga a ordem de grandeza aqui (milhares de
disparos/dia). Ganha atomicidade com o dado de negócio e um serviço a menos. Revisar se
passar de ~50 mensagens/segundo sustentadas.

**ADR-002 — Meta Cloud API como único canal na v1.**
Elimina risco de ban (fatal num produto de cobrança) ao custo de onboarding mais lento.
O schema isola o provedor em `canal_whatsapp.provedor`, então plugar Evolution depois é
aditivo, sem migração destrutiva.

**ADR-003 — Catálogo de planos em tabela, não em código.**
`src/lib/plans.ts` vira seed de `plano`/`plano_preco`. Mudar preço não pode exigir
deploy, e assinatura antiga precisa manter o preço contratado (grandfathering) — por
isso `assinatura` guarda o valor fechado, não só o `plano_id`.

**ADR-004 — Dinheiro em `bigint` de centavos.**
Nunca `float`. `numeric` só onde há fração real (custo de token em USD).

**ADR-005 — Todo timestamp é `timestamptz`; a org tem `fuso`.**
`regua_etapa.hora` é hora **local** ("09:00 no fuso da clínica"). O cálculo do
`executar_em` converte na hora da materialização. Sem isso, horário de verão e clientes
no Acre geram disparo à meia-noite.
