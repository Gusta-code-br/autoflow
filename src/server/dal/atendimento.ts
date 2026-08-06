import "server-only";

import { canalReal } from "../canais/fabrica";
import { comOrg } from "../db";
import { exigirContexto } from "./contexto";

/**
 * Caixa de entrada: conversas e mensagens.
 *
 * A tela é uma lista à esquerda e uma thread à direita, e a tentação é fazer
 * uma query só com JOIN de mensagem. Não: uma organização com 300 conversas de
 * 200 mensagens traria 60 mil linhas para pintar 12. A lista traz só a última
 * mensagem via LATERAL, e a thread é carregada por conversa escolhida.
 *
 * A janela de 24h da Cloud API aparece aqui como dado de primeira classe
 * (`janelaExpiraEm`): fora dela o WhatsApp recusa mensagem livre, e o operador
 * precisa saber disso *antes* de digitar, não depois do erro de envio.
 */

export type ModoConversa = "ia" | "humano";
export type IntencaoConversa =
  | "cobranca"
  | "agendamento"
  | "duvida"
  | "suporte"
  | "outro";
export type AutorMensagem = "contato" | "ia" | "humano" | "sistema";
export type StatusMensagem = "pendente" | "enviada" | "entregue" | "lida" | "falhou";

export interface ConversaLista {
  id: string;
  contatoId: string;
  contatoNome: string;
  contatoTelefone: string;
  canalId: string;
  canalNome: string;
  modo: ModoConversa;
  intencao: IntencaoConversa;
  resumoIa: string | null;
  naoLidas: number;
  ultimaAtividadeEm: Date;
  janelaExpiraEm: Date | null;
  /** `false` quando a janela de 24h fechou: só template resolve. */
  janelaAberta: boolean;
  previa: string | null;
  previaAutor: AutorMensagem | null;
  atribuidoNome: string | null;
  arquivada: boolean;
}

export interface MensagemDTO {
  id: string;
  direcao: "entrada" | "saida";
  autor: AutorMensagem;
  autorNome: string | null;
  texto: string | null;
  tipoMidia: string | null;
  midiaUrl: string | null;
  status: StatusMensagem;
  erro: string | null;
  criadoEm: Date;
  entregueEm: Date | null;
  lidaEm: Date | null;
}

export interface ThreadConversa {
  conversa: ConversaLista;
  mensagens: MensagemDTO[];
  contato: {
    id: string;
    nome: string;
    telefone: string;
    email: string | null;
    tags: string[];
    observacao: string | null;
    optOut: boolean;
  };
  /** Contexto que o atendente humano precisa ter na mão, sem trocar de tela. */
  cobrancasAbertas: {
    id: string;
    descricao: string;
    valor: string;
    venceEm: string;
    status: string;
  }[];
  proximosAgendamentos: {
    id: string;
    servico: string | null;
    inicio: Date;
    status: string;
  }[];
}

export interface FiltroConversas {
  busca?: string;
  modo?: ModoConversa;
  intencao?: IntencaoConversa;
  apenasNaoLidas?: boolean;
  incluirArquivadas?: boolean;
}

interface LinhaConversa {
  id: string;
  contato_id: string;
  contato_nome: string;
  contato_telefone: string;
  canal_id: string;
  canal_nome: string;
  modo: ModoConversa;
  intencao: IntencaoConversa;
  resumo_ia: string | null;
  nao_lidas: number;
  ultima_atividade_em: Date;
  janela_expira_em: Date | null;
  previa: string | null;
  previa_autor: AutorMensagem | null;
  atribuido_nome: string | null;
  arquivada_em: Date | null;
}

function paraConversa(l: LinhaConversa): ConversaLista {
  return {
    id: l.id,
    contatoId: l.contato_id,
    contatoNome: l.contato_nome,
    contatoTelefone: l.contato_telefone,
    canalId: l.canal_id,
    canalNome: l.canal_nome,
    modo: l.modo,
    intencao: l.intencao,
    resumoIa: l.resumo_ia,
    naoLidas: l.nao_lidas,
    ultimaAtividadeEm: l.ultima_atividade_em,
    janelaExpiraEm: l.janela_expira_em,
    janelaAberta: l.janela_expira_em !== null && l.janela_expira_em.getTime() > Date.now(),
    previa: l.previa,
    previaAutor: l.previa_autor,
    atribuidoNome: l.atribuido_nome,
    arquivada: l.arquivada_em !== null,
  };
}

/**
 * Fragmento compartilhado entre a lista e a abertura da thread.
 *
 * É uma função que recebe o `tx` e devolve um fragmento tagueado — não uma
 * string interpolada. Fragmentos aninhados são a forma que o postgres.js dá
 * para reaproveitar SQL sem abrir mão da parametrização.
 */
type Tx = Parameters<Parameters<typeof comOrg>[1]>[0];

const selecaoConversa = (tx: Tx) => tx`
  c.id, c.contato_id, ct.nome AS contato_nome, ct.telefone_e164 AS contato_telefone,
  c.canal_id, cw.nome AS canal_nome, c.modo, c.intencao, c.resumo_ia,
  c.nao_lidas, c.ultima_atividade_em, c.janela_expira_em, c.arquivada_em,
  u.nome AS atribuido_nome,
  m.texto AS previa, m.autor AS previa_autor
`;

export async function listarConversas(
  filtro: FiltroConversas = {},
): Promise<ConversaLista[]> {
  const ctx = await exigirContexto();

  return comOrg(ctx.orgId, async (tx) => {
    const busca = filtro.busca?.trim() ?? "";
    const linhas = await tx<LinhaConversa[]>`
      SELECT ${selecaoConversa(tx)}
        FROM conversa c
        JOIN contato ct ON ct.id = c.contato_id
        JOIN canal_whatsapp cw ON cw.id = c.canal_id
        LEFT JOIN usuario u ON u.id = c.atribuido_a
        /*
         * LATERAL em vez de subquery correlacionada no SELECT: o planner usa o
         * índice (conversa_id, criado_em DESC) e para no primeiro registro.
         */
        LEFT JOIN LATERAL (
          SELECT texto, autor FROM mensagem
           WHERE conversa_id = c.id
           ORDER BY criado_em DESC
           LIMIT 1
        ) m ON true
       WHERE ${filtro.incluirArquivadas ? tx`true` : tx`c.arquivada_em IS NULL`}
         AND ${filtro.modo ? tx`c.modo = ${filtro.modo}` : tx`true`}
         AND ${filtro.intencao ? tx`c.intencao = ${filtro.intencao}` : tx`true`}
         AND ${filtro.apenasNaoLidas ? tx`c.nao_lidas > 0` : tx`true`}
         AND ${
           busca
             ? tx`(ct.nome ILIKE ${"%" + busca + "%"} OR ct.telefone_e164 ILIKE ${"%" + busca + "%"})`
             : tx`true`
         }
       ORDER BY c.ultima_atividade_em DESC
       LIMIT 100
    `;
    return linhas.map(paraConversa);
  });
}

/**
 * Thread completa de uma conversa.
 *
 * Devolve `null` em vez de lançar quando o id não existe *ou* pertence a outro
 * tenant — com RLS ligada os dois casos são indistinguíveis do lado do SQL, e
 * essa indistinguibilidade é justamente o que impede sondar ids alheios.
 */
export async function abrirConversa(
  conversaId: string,
  limite = 200,
): Promise<ThreadConversa | null> {
  const ctx = await exigirContexto();

  return comOrg(ctx.orgId, async (tx) => {
    const [linha] = await tx<LinhaConversa[]>`
      SELECT ${selecaoConversa(tx)}
        FROM conversa c
        JOIN contato ct ON ct.id = c.contato_id
        JOIN canal_whatsapp cw ON cw.id = c.canal_id
        LEFT JOIN usuario u ON u.id = c.atribuido_a
        LEFT JOIN LATERAL (
          SELECT texto, autor FROM mensagem
           WHERE conversa_id = c.id ORDER BY criado_em DESC LIMIT 1
        ) m ON true
       WHERE c.id = ${conversaId}
    `;
    if (!linha) return null;

    /*
     * Sequencial de propósito: as quatro leituras compartilham a transação que
     * carrega o `app.org_id`, e uma única conexão não executa queries em
     * paralelo. Rodar `Promise.all` aqui só empilharia trabalho na mesma
     * conexão — sem ganho e com risco de erro de protocolo.
     */
    const mensagens = await tx<
        {
          id: string;
          direcao: "entrada" | "saida";
          autor: AutorMensagem;
          autor_nome: string | null;
          texto: string | null;
          tipo_midia: string | null;
          midia_url: string | null;
          status: StatusMensagem;
          erro: string | null;
          criado_em: Date;
          entregue_em: Date | null;
          lida_em: Date | null;
        }[]
      >`
        SELECT m.id, m.direcao, m.autor, u.nome AS autor_nome, m.texto,
               m.tipo_midia, m.midia_url, m.status, m.erro,
               m.criado_em, m.entregue_em, m.lida_em
          FROM mensagem m
          LEFT JOIN usuario u ON u.id = m.autor_usuario_id
         WHERE m.conversa_id = ${conversaId}
         ORDER BY m.criado_em DESC
         LIMIT ${limite}
      `;

    const contato = await tx<
        {
          id: string;
          nome: string;
          telefone_e164: string;
          email: string | null;
          tags: string[];
          observacao: string | null;
          opt_out_em: Date | null;
        }[]
      >`
        SELECT id, nome, telefone_e164, email, tags, observacao, opt_out_em
          FROM contato WHERE id = ${linha.contato_id}
      `;

    const cobrancas = await tx<
        {
          id: string;
          descricao: string;
          valor: string;
          vence_em: string;
          status: string;
        }[]
      >`
        SELECT id, descricao, valor::text, vencimento::text AS vence_em, status
          FROM cobranca
         WHERE contato_id = ${linha.contato_id}
           AND status IN ('pendente','vencido','negociando')
         ORDER BY vencimento
         LIMIT 5
      `;

    const agendamentos = await tx<
      { id: string; servico: string | null; inicio: Date; status: string }[]
    >`
        SELECT a.id, s.nome AS servico, a.inicio, a.status
          FROM agendamento a
          LEFT JOIN servico s ON s.id = a.servico_id
         WHERE a.contato_id = ${linha.contato_id}
           AND a.inicio >= now() - interval '1 day'
           AND a.status IN ('pendente','confirmado')
         ORDER BY a.inicio
         LIMIT 5
      `;

    const c = contato[0];
    return {
      conversa: paraConversa(linha),
      // A query desce do mais novo para usar o índice; a UI lê de cima para
      // baixo. Inverter aqui é mais barato que um ORDER BY ASC com OFFSET.
      mensagens: mensagens.reverse().map((m) => ({
        id: m.id,
        direcao: m.direcao,
        autor: m.autor,
        autorNome: m.autor_nome,
        texto: m.texto,
        tipoMidia: m.tipo_midia,
        midiaUrl: m.midia_url,
        status: m.status,
        erro: m.erro,
        criadoEm: m.criado_em,
        entregueEm: m.entregue_em,
        lidaEm: m.lida_em,
      })),
      contato: {
        id: c.id,
        nome: c.nome,
        telefone: c.telefone_e164,
        email: c.email,
        tags: c.tags ?? [],
        observacao: c.observacao,
        optOut: c.opt_out_em !== null,
      },
      cobrancasAbertas: cobrancas.map((x) => ({
        id: x.id,
        descricao: x.descricao,
        valor: x.valor,
        venceEm: x.vence_em,
        status: x.status,
      })),
      proximosAgendamentos: agendamentos.map((a) => ({
        id: a.id,
        servico: a.servico,
        inicio: a.inicio,
        status: a.status,
      })),
    };
  });
}

export interface ResumoAtendimento {
  conversasAtivas: number;
  naoLidas: number;
  emHumano: number;
  janelasFechando: number;
}

export async function resumoAtendimento(): Promise<ResumoAtendimento> {
  const ctx = await exigirContexto();

  return comOrg(ctx.orgId, async (tx) => {
    const [r] = await tx<
      {
        conversas_ativas: string;
        nao_lidas: string;
        em_humano: string;
        janelas_fechando: string;
      }[]
    >`
      SELECT count(*) FILTER (
               WHERE ultima_atividade_em > now() - interval '7 days'
             )::text AS conversas_ativas,
             count(*) FILTER (WHERE nao_lidas > 0)::text AS nao_lidas,
             count(*) FILTER (WHERE modo = 'humano')::text AS em_humano,
             count(*) FILTER (
               WHERE janela_expira_em BETWEEN now() AND now() + interval '2 hours'
             )::text AS janelas_fechando
        FROM conversa
       WHERE arquivada_em IS NULL
    `;
    return {
      conversasAtivas: Number(r.conversas_ativas),
      naoLidas: Number(r.nao_lidas),
      emHumano: Number(r.em_humano),
      janelasFechando: Number(r.janelas_fechando),
    };
  });
}

export interface ContagensCaixa {
  todas: number;
  naoLidas: number;
  cobranca: number;
  agendamento: number;
}

/**
 * Os números dos filtros da caixa de entrada.
 *
 * Existe separado de `listarConversas` porque as abas mostram o total de cada
 * fatia mesmo quando a lista visível está filtrada — contar em cima do array já
 * filtrado daria sempre o mesmo número da aba ativa. Uma varredura com
 * `FILTER` resolve as quatro contagens de uma vez.
 */
export async function contagensCaixa(): Promise<ContagensCaixa> {
  const ctx = await exigirContexto();

  return comOrg(ctx.orgId, async (tx) => {
    const [r] = await tx<
      { todas: string; nao_lidas: string; cobranca: string; agendamento: string }[]
    >`
      SELECT count(*)::text AS todas,
             count(*) FILTER (WHERE nao_lidas > 0)::text AS nao_lidas,
             count(*) FILTER (WHERE intencao = 'cobranca')::text AS cobranca,
             count(*) FILTER (WHERE intencao = 'agendamento')::text AS agendamento
        FROM conversa
       WHERE arquivada_em IS NULL
    `;
    return {
      todas: Number(r.todas),
      naoLidas: Number(r.nao_lidas),
      cobranca: Number(r.cobranca),
      agendamento: Number(r.agendamento),
    };
  });
}

// ---------------------------------------------------------------------------
// Escrita

/**
 * Zera o contador de não lidas.
 *
 * Só marca; não carimba `lida_em` nas mensagens do contato, porque "lida" ali
 * significa *o contato leu a nossa*, informação que vem do provedor. Misturar
 * as duas coisas quebra o relatório de entrega.
 */
export async function marcarLida(conversaId: string): Promise<void> {
  const ctx = await exigirContexto();
  await comOrg(ctx.orgId, async (tx) => {
    await tx`UPDATE conversa SET nao_lidas = 0 WHERE id = ${conversaId}`;
  });
}

/**
 * Alterna entre atendimento por IA e por humano.
 *
 * Ao assumir, registra quem assumiu: sem isso, duas pessoas do mesmo time
 * respondem o mesmo cliente em paralelo. Ao devolver para a IA, limpa a
 * atribuição para não deixar "dono" fantasma na fila.
 */
export async function definirModo(
  conversaId: string,
  modo: ModoConversa,
): Promise<void> {
  const ctx = await exigirContexto();

  await comOrg(ctx.orgId, async (tx) => {
    await tx`
      UPDATE conversa
         SET modo = ${modo},
             atribuido_a = ${modo === "humano" ? ctx.usuarioId : null}
       WHERE id = ${conversaId}
    `;
    await tx`
      INSERT INTO mensagem (org_id, conversa_id, direcao, autor, texto, status)
      VALUES (${ctx.orgId}, ${conversaId}, 'saida', 'sistema',
              ${modo === "humano" ? "Atendimento assumido por um humano." : "Atendimento devolvido para a IA."},
              'enviada')
    `;
  });
}

export async function arquivarConversa(
  conversaId: string,
  arquivar: boolean,
): Promise<void> {
  const ctx = await exigirContexto();
  await comOrg(ctx.orgId, async (tx) => {
    await tx`
      UPDATE conversa
         SET arquivada_em = ${arquivar ? new Date() : null}
       WHERE id = ${conversaId}
    `;
  });
}

export type ResultadoResposta =
  | { ok: true; mensagemId: string }
  | { ok: false; erro: string };

/**
 * Resposta manual de um atendente humano.
 *
 * Três coisas acontecem em ordem e a ordem importa:
 *
 * 1. A mensagem é gravada como `pendente` ANTES de sair. Se o processo morrer
 *    no meio do POST para a Meta, sobra uma linha pendente — visível, corrigível
 *    — em vez de uma mensagem que o cliente recebeu e o histórico não tem.
 * 2. O envio acontece FORA de transação. Segurar uma conexão de banco durante
 *    um round-trip HTTP de até 30s é o jeito mais rápido de esgotar o pool.
 * 3. O débito de crédito só ocorre no sucesso, com idempotência amarrada ao id
 *    da mensagem: reenvio da mesma linha não debita duas vezes.
 *
 * A janela de 24h é checada aqui e não só na UI: o botão desabilitado do front
 * é conforto, esta checagem é a regra.
 */
export async function responderConversa(
  conversaId: string,
  texto: string,
): Promise<ResultadoResposta> {
  const ctx = await exigirContexto();

  const corpo = texto.trim();
  if (!corpo) return { ok: false, erro: "Escreva alguma coisa antes de enviar." };
  if (corpo.length > 4096) {
    return { ok: false, erro: "O WhatsApp aceita no máximo 4096 caracteres." };
  }

  type Preparo =
    | { ok: false; erro: string }
    | { ok: true; mensagemId: string; telefone: string };

  const preparo = await comOrg<Preparo>(ctx.orgId, async (tx) => {
    const [conversa] = await tx<
      {
        id: string;
        telefone: string;
        opt_out: boolean;
        janela_expira_em: Date | null;
      }[]
    >`
      SELECT c.id, ct.telefone_e164 AS telefone, ct.opt_out, c.janela_expira_em
        FROM conversa c
        JOIN contato ct ON ct.id = c.contato_id
       WHERE c.id = ${conversaId}
    `;
    if (!conversa) return { ok: false, erro: "Conversa não encontrada." };
    if (conversa.opt_out) {
      return { ok: false, erro: "Este contato pediu para não receber mensagens." };
    }
    if (
      !conversa.janela_expira_em ||
      conversa.janela_expira_em.getTime() <= Date.now()
    ) {
      return {
        ok: false,
        erro:
          "A janela de 24h fechou. Só um template aprovado reabre a conversa.",
      };
    }

    const [msg] = await tx<{ id: string }[]>`
      INSERT INTO mensagem (org_id, conversa_id, direcao, autor, autor_usuario_id,
                            texto, status)
      VALUES (${ctx.orgId}, ${conversaId}, 'saida', 'humano', ${ctx.usuarioId},
              ${corpo}, 'pendente')
      RETURNING id
    `;

    // Assumir a conversa é implícito: quem responde no braço vira o dono. Sem
    // isso a IA continuaria respondendo por cima do humano na próxima entrada.
    await tx`
      UPDATE conversa
         SET modo = 'humano',
             atribuido_a = ${ctx.usuarioId},
             nao_lidas = 0,
             ultima_atividade_em = now()
       WHERE id = ${conversaId}
    `;

    return { ok: true, mensagemId: msg.id, telefone: conversa.telefone };
  });

  if (!preparo.ok) return preparo;

  const envio = await canalReal().enviarTexto({
    orgId: ctx.orgId,
    para: preparo.telefone,
    texto: corpo,
    idempotencia: `mensagem:${preparo.mensagemId}`,
  });

  if (!envio.ok) {
    await comOrg(ctx.orgId, async (tx) => {
      await tx`
        UPDATE mensagem
           SET status = 'falhou', erro = ${envio.erro}
         WHERE id = ${preparo.mensagemId}
      `;
    });
    return { ok: false, erro: envio.erro };
  }

  await comOrg(ctx.orgId, async (tx) => {
    await tx`
      UPDATE mensagem
         SET status = 'enviada',
             provider_id = ${envio.provedorId},
             enviada_em = now()
       WHERE id = ${preparo.mensagemId}
    `;
    // O trigger tg_movimento_credito debita o saldo e recusa saldo negativo.
    // Se recusar, a mensagem já saiu — por isso a resposta humana debita
    // *depois* e não bloqueia: cobrar um crédito é menos grave do que deixar o
    // atendente mudo com o cliente esperando.
    await tx`
      INSERT INTO movimento_credito (org_id, tipo, quantidade, saldo_apos,
                                     origem_tipo, origem_id, idempotencia)
      VALUES (${ctx.orgId}, 'consumo', -1, 0, 'mensagem',
              ${preparo.mensagemId}, ${`mensagem:${preparo.mensagemId}`})
      ON CONFLICT (org_id, idempotencia) DO NOTHING
    `;
  });

  return { ok: true, mensagemId: preparo.mensagemId };
}
