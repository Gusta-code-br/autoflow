import "server-only";

import OpenAI from "openai";
import { comAdmin } from "../db";
import { decifrar } from "../seguranca/cripto";

/**
 * Gera a resposta automática de uma conversa.
 *
 * O worker (`../worker/ia.ts`) reserva a tarefa 'responder_ia' e chama
 * `gerarResposta`; esta função só sabe montar o prompt a partir do estado
 * da conversa e falar com a OpenAI (ChatGPT) — não sabe nada de fila, crédito
 * ou envio pelo canal, para poder ser testada sem banco de fila nem WhatsApp.
 */

const MODELO_PADRAO = "gpt-4o-mini";
const MAX_TOKENS_SAIDA = 700;
/** Mensagens mais antigas que isso na thread não entram no prompt: custo e
 * relevância caem juntos depois de um certo tamanho de histórico. */
const MAX_MENSAGENS_HISTORICO = 20;

/** Cada organização paga o consumo da IA com a própria chave OpenAI — não há
 * chave global de fallback no .env. Um client por chamada evita cachear a
 * chave de uma org e vazá-la para outra numa reutilização acidental. */
function openai(apiKey: string): OpenAI {
  return new OpenAI({ apiKey });
}

export interface RespostaIA {
  texto: string;
  modelo: string;
  tokensEntrada: number;
  tokensSaida: number;
}

/** Quando a IA não tem nada útil a dizer (ex.: janela fechou no meio do
 * processamento), devolve `null` em vez de forçar uma resposta ruim. */
export type ResultadoResposta = RespostaIA | null;

interface LinhaOrganizacao {
  nome_empresa: string;
  nome_atendente: string;
  tom: string;
  objetivos: string[];
  instrucoes_extra: string | null;
  openai_api_key_cif: string | null;
}

interface LinhaContato {
  nome: string;
  tags: string[];
  observacao: string | null;
}

interface LinhaMensagem {
  autor: "contato" | "ia" | "humano" | "sistema";
  texto: string | null;
  tipo_midia: string | null;
  criado_em: Date;
}

const ROTULO_TOM: Record<string, string> = {
  amigavel: "amigável e próximo, mas sem exagerar em gírias",
  formal: "formal e objetivo",
  divertido: "descontraído, com bom humor moderado",
};

const ROTULO_OBJETIVO: Record<string, string> = {
  responder: "tirar dúvidas sobre a empresa e os produtos/serviços",
  agendar: "ajudar o cliente a marcar um horário",
  cobrar: "lembrar educadamente de pagamentos e cobranças em aberto",
  qualificar: "entender a necessidade do cliente antes de encaminhar",
  orcamento: "levantar informações para um orçamento",
  "pos-venda": "acompanhar o cliente depois da compra",
};

function montarSystemPrompt(org: LinhaOrganizacao, contato: LinhaContato): string {
  const tom = ROTULO_TOM[org.tom] ?? org.tom;
  const objetivos = org.objetivos.length
    ? org.objetivos.map((o) => ROTULO_OBJETIVO[o] ?? o).join("; ")
    : "atender bem quem escreve";

  const linhas = [
    `Você é ${org.nome_atendente}, atendente virtual da empresa "${org.nome_empresa}" no WhatsApp.`,
    `Tom de voz: ${tom}.`,
    `Seus objetivos nesta conversa: ${objetivos}.`,
    "",
    "Regras:",
    "- Responda em português do Brasil, em texto puro (sem markdown), como uma pessoa escreveria no WhatsApp.",
    "- Seja breve: 1 a 3 frases na maioria das vezes. Nada de listas longas.",
    "- Nunca invente preço, prazo, disponibilidade ou política que você não tem certeza — se não souber, diga que vai verificar e chama um humano.",
    "- Se o cliente pedir para falar com uma pessoa, ficar irritado, ou o assunto for sensível (jurídico, reclamação grave), diga que vai encaminhar para o time e pare de tentar resolver sozinho.",
    "- Nunca peça senha, dados de cartão completo ou código de verificação.",
  ];

  if (contato.observacao) {
    linhas.push(`Observação interna sobre este cliente: ${contato.observacao}`);
  }
  if (contato.tags.length) {
    linhas.push(`Marcadores deste cliente: ${contato.tags.join(", ")}.`);
  }
  if (org.instrucoes_extra) {
    linhas.push("", "Instruções específicas da empresa:", org.instrucoes_extra);
  }

  return linhas.join("\n");
}

function paraMensagemOpenAI(
  m: LinhaMensagem,
): { role: "user" | "assistant"; content: string } | null {
  const texto =
    m.texto?.trim() ||
    (m.tipo_midia ? `[${m.tipo_midia} recebido, sem legenda]` : null);
  if (!texto) return null;

  // 'sistema' não tem um papel natural no chat da OpenAI — dobra para
  // dentro da fala do assistente em vez de descartar o contexto.
  const role = m.autor === "contato" ? "user" : "assistant";
  return { role, content: texto };
}

/**
 * Junta mensagens seguidas do mesmo papel. A API da OpenAI aceita papéis
 * repetidos em sequência, mas juntar reduz tokens e deixa o histórico mais
 * limpo quando o contato manda várias mensagens seguidas (ex.: duas fotos).
 */
function agruparAlternado(
  mensagens: { role: "user" | "assistant"; content: string }[],
): { role: "user" | "assistant"; content: string }[] {
  const agrupado: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of mensagens) {
    const ultimo = agrupado[agrupado.length - 1];
    if (ultimo && ultimo.role === m.role) {
      ultimo.content += `\n${m.content}`;
    } else {
      agrupado.push({ ...m });
    }
  }
  return agrupado;
}

/**
 * Monta o prompt a partir do estado atual da conversa e chama a OpenAI.
 * Não escreve no banco nem envia nada — só decide o que dizer.
 */
export async function gerarResposta(conversaId: string): Promise<ResultadoResposta> {
  const dados = await comAdmin(async (tx) => {
    const [conversa] = await tx<
      { org_id: string; janela_expira_em: Date | null; contato_id: string }[]
    >`
      SELECT org_id, janela_expira_em, contato_id
        FROM conversa
       WHERE id = ${conversaId}
    `;
    if (!conversa) return null;

    const [org] = await tx<LinhaOrganizacao[]>`
      SELECT nome_empresa, nome_atendente, tom, objetivos, instrucoes_extra, openai_api_key_cif
        FROM organizacao
       WHERE id = ${conversa.org_id}
    `;
    const [contato] = await tx<LinhaContato[]>`
      SELECT nome, tags, observacao
        FROM contato
       WHERE id = ${conversa.contato_id}
    `;
    const mensagens = await tx<LinhaMensagem[]>`
      SELECT autor, texto, tipo_midia, criado_em
        FROM mensagem
       WHERE conversa_id = ${conversaId}
       ORDER BY criado_em DESC
       LIMIT ${MAX_MENSAGENS_HISTORICO}
    `;

    return { conversa, org, contato, mensagens: mensagens.reverse() };
  });

  if (!dados || !dados.org || !dados.contato) return null;

  if (!dados.org.openai_api_key_cif) {
    throw new Error(
      "Chave OpenAI não configurada — o cliente precisa informar a chave própria na página de configurações.",
    );
  }
  const apiKey = decifrar(dados.org.openai_api_key_cif, `openai:${dados.conversa.org_id}`);

  // Janela de 24h fechou enquanto a tarefa esperava na fila: não vale gerar
  // uma resposta que não vai poder ser enviada como texto livre.
  if (
    !dados.conversa.janela_expira_em ||
    dados.conversa.janela_expira_em.getTime() <= Date.now()
  ) {
    return null;
  }

  const historico = agruparAlternado(
    dados.mensagens
      .map(paraMensagemOpenAI)
      .filter((m): m is NonNullable<typeof m> => m !== null),
  );

  // Não faz sentido gerar uma resposta nova se não há nada do contato no
  // histórico para responder.
  if (historico.length === 0 || !historico.some((m) => m.role === "user")) {
    return null;
  }

  const modelo = process.env.OPENAI_MODEL || MODELO_PADRAO;

  const resposta = await openai(apiKey).chat.completions.create({
    model: modelo,
    max_completion_tokens: MAX_TOKENS_SAIDA,
    messages: [
      { role: "system", content: montarSystemPrompt(dados.org, dados.contato) },
      ...historico,
    ],
  });

  const texto = resposta.choices[0]?.message?.content?.trim();

  if (!texto) return null;

  return {
    texto,
    modelo,
    tokensEntrada: resposta.usage?.prompt_tokens ?? 0,
    tokensSaida: resposta.usage?.completion_tokens ?? 0,
  };
}
