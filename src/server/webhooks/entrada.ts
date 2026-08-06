import "server-only";

import { comAdmin, type Transacao } from "@/server/db";
import { normalizarE164 } from "@/server/dominio/telefone";

/**
 * O que acontece quando um cliente responde.
 *
 * Esta é a parte do produto que o dono do negócio mais sente: se a régua
 * continuar cobrando alguém que já respondeu ("já paguei, mandei o
 * comprovante"), ele perde o cliente e o número toma denúncia. Então uma
 * mensagem de entrada faz cinco coisas, todas na mesma transação:
 *
 *   1. reabre a janela de 24h (a Meta conta a partir da última mensagem DELE);
 *   2. registra a mensagem (idempotente pelo provider_id);
 *   3. pausa as réguas ativas do contato, se configuradas para isso;
 *   4. respeita opt-out ("PARAR") — LGPD e sobrevivência do número;
 *   5. enfileira a IA, se a conversa estiver em modo automático.
 *
 * Roda com `comAdmin` porque webhook não tem sessão: não existe org_id no
 * contexto até descobrirmos de quem é o número. Por isso toda query aqui
 * carrega `org_id` explícito — é a RLS na mão, e a revisão desse arquivo
 * precisa olhar isso com atenção.
 */

/** Palavras que param tudo. Comparadas sobre o texto inteiro, não contido. */
const PALAVRAS_OPT_OUT = new Set([
  "parar",
  "pare",
  "sair",
  "cancelar",
  "descadastrar",
  "remover",
  "stop",
  "nao quero receber",
  "não quero receber",
  "nao perturbe",
  "não perturbe",
]);

/** Janela da Meta: 24h desde a última mensagem do cliente. */
const JANELA_HORAS = 24;

export interface MensagemRecebida {
  /** wamid da Meta / key.id da Evolution — chave de idempotência. */
  provedorId: string;
  telefone: string;
  nome?: string | null;
  texto?: string | null;
  tipoMidia?: string | null;
  midiaUrl?: string | null;
  /** Quando o cliente mandou (não quando processamos). */
  em?: Date | null;
}

export interface StatusRecebido {
  provedorId: string;
  status: "enviada" | "entregue" | "lida" | "falhou";
  erro?: string | null;
  em?: Date | null;
}

export interface CanalResolvido {
  canalId: string;
  orgId: string;
}

export interface ResultadoEntrada {
  /** false quando a mensagem já tinha sido processada (reentrega). */
  nova: boolean;
  conversaId?: string;
  optOut?: boolean;
  reguasPausadas?: number;
}

/** Acha o canal pelo phone_number_id que a Meta manda no payload. */
export async function canalPorPhoneNumberId(
  phoneNumberId: string,
): Promise<CanalResolvido | null> {
  const [l] = await comAdmin(
    (tx) => tx<{ id: string; org_id: string }[]>`
      SELECT id, org_id FROM canal_whatsapp
       WHERE phone_number_id = ${phoneNumberId}
       LIMIT 1
    `,
  );
  return l ? { canalId: l.id, orgId: l.org_id } : null;
}

/**
 * Provedores sem assinatura (Evolution) se identificam pelo segredo da própria
 * URL. Guardamos só o HMAC dele, então a busca é por hash — e o canal só
 * responde se o id da rota e o token baterem na MESMA linha, senão um token
 * válido de um canal abriria o webhook de outro.
 */
export async function canalPorTokenWebhook(
  canalId: string,
  tokenHash: string,
): Promise<CanalResolvido | null> {
  if (!/^[0-9a-f-]{36}$/i.test(canalId)) return null;

  const [l] = await comAdmin(
    (tx) => tx<{ id: string; org_id: string }[]>`
      SELECT id, org_id FROM canal_whatsapp
       WHERE id = ${canalId}::uuid
         AND webhook_token_hash = ${tokenHash}
       LIMIT 1
    `,
  );
  return l ? { canalId: l.id, orgId: l.org_id } : null;
}

/**
 * Grava o evento cru antes de interpretar. Se a interpretação explodir, o
 * payload continua no banco para reprocessar — e a UNIQUE (provedor,
 * evento_id) faz a reentrega do provedor virar no-op.
 *
 * Devolve false se já tínhamos esse evento.
 */
export async function registrarEvento(
  provedor: string,
  eventoId: string,
  tipo: string | null,
  payload: unknown,
  orgId?: string | null,
): Promise<boolean> {
  const linhas = await comAdmin(
    (tx) => tx<{ id: string }[]>`
      INSERT INTO evento_webhook (provedor, evento_id, tipo, org_id, payload)
      VALUES (${provedor}, ${eventoId}, ${tipo}, ${orgId ?? null},
              ${tx.json(payload as never)})
      ON CONFLICT (provedor, evento_id) DO NOTHING
      RETURNING id
    `,
  );
  return linhas.length > 0;
}

export async function marcarEventoProcessado(
  provedor: string,
  eventoId: string,
  erro?: string | null,
): Promise<void> {
  await comAdmin(
    (tx) => tx`
      UPDATE evento_webhook
         SET processado_em = ${erro ? null : new Date()},
             tentativas = tentativas + 1,
             erro = ${erro ?? null}::text
       WHERE provedor = ${provedor} AND evento_id = ${eventoId}
    `,
  );
}

/** Fluxo completo de uma mensagem de entrada. */
export async function processarMensagem(
  canal: CanalResolvido,
  msg: MensagemRecebida,
): Promise<ResultadoEntrada> {
  const e164 = normalizarE164(msg.telefone);
  if (!e164) {
    // Número que não dá para normalizar não vira contato: gravar lixo aqui
    // significa mandar mensagem para estranho depois.
    return { nova: false };
  }

  return comAdmin(async (tx) => {
    const contatoId = await acharOuCriarContato(tx, canal.orgId, e164, msg.nome);
    const conversaId = await abrirJanela(tx, canal, contatoId);

    const [linha] = await tx<{ id: string }[]>`
      INSERT INTO mensagem (org_id, conversa_id, direcao, autor, texto,
                            tipo_midia, midia_url, status, provider_id,
                            criado_em)
      VALUES (${canal.orgId}, ${conversaId}, 'entrada', 'contato',
              ${msg.texto ?? null}, ${msg.tipoMidia ?? null},
              ${msg.midiaUrl ?? null}, 'lida', ${msg.provedorId},
              ${msg.em ?? new Date()})
      ON CONFLICT (org_id, provider_id) DO NOTHING
      RETURNING id
    `;

    // Sem linha = reentrega do mesmo wamid. Sair aqui é o que impede pausar a
    // régua duas vezes ou contar a mesma resposta duas vezes.
    if (!linha) return { nova: false, conversaId };

    await tx`
      UPDATE contato
         SET ultima_interacao_em = now(), atualizado_em = now()
       WHERE id = ${contatoId} AND org_id = ${canal.orgId}
    `;

    const optOut = ehOptOut(msg.texto);
    if (optOut) await registrarOptOut(tx, canal.orgId, contatoId);

    const reguasPausadas = await pausarReguas(
      tx,
      canal.orgId,
      contatoId,
      optOut,
    );

    if (!optOut) await enfileirarIA(tx, canal.orgId, conversaId, linha.id);

    return { nova: true, conversaId, optOut, reguasPausadas };
  });
}

/**
 * Status de entrega. Só avança: a Meta entrega `delivered` e `read` fora de
 * ordem com frequência, e uma mensagem lida não pode voltar para "enviada" na
 * tela do cliente.
 */
export async function processarStatus(
  canal: CanalResolvido,
  st: StatusRecebido,
): Promise<boolean> {
  const em = st.em ?? new Date();

  const linhas = await comAdmin(
    (tx) => tx<{ id: string }[]>`
      UPDATE mensagem
         SET status = ${st.status}::status_mensagem,
             erro = COALESCE(${st.erro ?? null}::text, erro),
             entregue_em = CASE WHEN ${st.status} IN ('entregue','lida')
                                THEN COALESCE(entregue_em, ${em}) ELSE entregue_em END,
             lida_em = CASE WHEN ${st.status} = 'lida'
                            THEN COALESCE(lida_em, ${em}) ELSE lida_em END
       WHERE org_id = ${canal.orgId}
         AND provider_id = ${st.provedorId}
         AND ordem_status(status) < ordem_status(${st.status}::status_mensagem)
       RETURNING id
    `,
  );

  return linhas.length > 0;
}

/**
 * O contato pode não existir: cliente que nunca foi cobrado manda mensagem
 * primeiro. Criar aqui é melhor que descartar — a conversa aparece na caixa de
 * entrada e o dono decide o que fazer.
 *
 * O nome do WhatsApp (`profile.name`) só preenche se ainda não houver nome
 * cadastrado: o que o dono digitou vale mais que o apelido do perfil.
 */
async function acharOuCriarContato(
  tx: Transacao,
  orgId: string,
  e164: string,
  nome?: string | null,
): Promise<string> {
  const [linha] = await tx<{ id: string }[]>`
    INSERT INTO contato (org_id, nome, telefone_e164)
    VALUES (${orgId}, ${nome?.trim() || e164}, ${e164})
    ON CONFLICT (org_id, telefone_e164) DO UPDATE
       SET nome = CASE
             WHEN contato.nome = contato.telefone_e164
              AND NULLIF(TRIM(${nome ?? null}::text), '') IS NOT NULL
             THEN TRIM(${nome ?? null}::text) ELSE contato.nome END,
           atualizado_em = now()
    RETURNING id
  `;
  return linha.id;
}

async function abrirJanela(
  tx: Transacao,
  canal: CanalResolvido,
  contatoId: string,
): Promise<string> {
  const [linha] = await tx<{ id: string }[]>`
    INSERT INTO conversa (org_id, contato_id, canal_id, janela_expira_em,
                          nao_lidas, ultima_atividade_em)
    VALUES (${canal.orgId}, ${contatoId}, ${canal.canalId},
            now() + make_interval(hours => ${JANELA_HORAS}), 1, now())
    ON CONFLICT (org_id, contato_id, canal_id) DO UPDATE
       SET janela_expira_em = now() + make_interval(hours => ${JANELA_HORAS}),
           nao_lidas = conversa.nao_lidas + 1,
           arquivada_em = NULL,
           ultima_atividade_em = now()
    RETURNING id
  `;
  return linha.id;
}

function ehOptOut(texto?: string | null): boolean {
  if (!texto) return false;
  const limpo = texto
    .trim()
    .toLowerCase()
    .replace(/[.!,;]+$/g, "");
  // Comparação por igualdade, não `includes`: "não vou parar de pagar" não é
  // pedido de descadastro, e tratar como tal cala uma cobrança legítima.
  return PALAVRAS_OPT_OUT.has(limpo);
}

async function registrarOptOut(
  tx: Transacao,
  orgId: string,
  contatoId: string,
): Promise<void> {
  await tx`
    UPDATE contato
       SET opt_out_em = COALESCE(opt_out_em, now()), atualizado_em = now()
     WHERE id = ${contatoId} AND org_id = ${orgId}
  `;
}

/**
 * Pausa as réguas ativas do contato.
 *
 * Sem opt-out, respeita a configuração da régua (`pausar_ao_responder`):
 * algumas cobranças de assinatura devem seguir mesmo com resposta. Com
 * opt-out, para tudo — não há configuração que valha mais que "não me mande
 * mais mensagem".
 *
 * Cancelar os disparos agendados junto é o que evita a corrida clássica: a
 * execução fica pausada, mas o disparo que já estava na fila sai assim mesmo.
 */
async function pausarReguas(
  tx: Transacao,
  orgId: string,
  contatoId: string,
  optOut: boolean,
): Promise<number> {
  const execucoes = await tx<{ id: string; cobranca_id: string }[]>`
    UPDATE regua_execucao e
       SET status = 'pausada',
           motivo_parada = ${optOut ? "opt_out" : "cliente_respondeu"},
           encerrada_em = now()
      FROM cobranca c, regua r
     WHERE e.cobranca_id = c.id
       AND e.regua_id = r.id
       AND e.org_id = ${orgId}
       AND e.status = 'ativa'
       AND c.contato_id = ${contatoId}
       AND (${optOut}::boolean OR r.pausar_ao_responder)
    RETURNING e.id, e.cobranca_id
  `;

  if (execucoes.length === 0) return 0;

  const ids = execucoes.map((e) => e.id);

  await tx`
    UPDATE disparo
       SET status = 'cancelado',
           motivo_ignorado = ${optOut ? "opt_out" : "cliente_respondeu"},
           processado_em = now()
     WHERE org_id = ${orgId}
       AND execucao_id = ANY(${ids}::uuid[])
       AND status = 'agendado'
  `;

  // Timeline da cobrança: o dono precisa ver por que a régua parou sozinha.
  for (const e of execucoes) {
    await tx`
      INSERT INTO cobranca_evento (org_id, cobranca_id, tipo, descricao)
      VALUES (${orgId}, ${e.cobranca_id}, ${optOut ? "opt_out" : "respondeu"},
              ${
                optOut
                  ? "Cliente pediu para não receber mais mensagens"
                  : "Cliente respondeu — régua pausada"
              })
    `;
  }

  return execucoes.length;
}

/**
 * Enfileira a resposta da IA só se a conversa estiver em modo automático e a
 * organização tiver a feature de atendimento. `chave_unica` amarra a tarefa à
 * mensagem: reprocessar o webhook não gera duas respostas.
 */
async function enfileirarIA(
  tx: Transacao,
  orgId: string,
  conversaId: string,
  mensagemId: string,
): Promise<void> {
  await tx`
    INSERT INTO tarefa (org_id, tipo, payload, chave_unica)
    SELECT ${orgId}, 'responder_ia',
           ${tx.json({ conversaId, mensagemId })},
           ${`responder_ia:${mensagemId}`}
      FROM conversa cv
      JOIN organizacao o ON o.id = cv.org_id
      JOIN assinatura a ON a.org_id = o.id AND a.status IN ('ativa','trial')
      JOIN plano p ON p.id = a.plano_id
     WHERE cv.id = ${conversaId}
       AND cv.org_id = ${orgId}
       AND cv.modo = 'ia'
       AND o.onboarding_completo
       AND 'atendimento' = ANY(p.features)
    ON CONFLICT (chave_unica) DO NOTHING
  `;
}
