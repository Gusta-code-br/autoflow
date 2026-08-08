import "server-only";

import { z } from "zod";

import { comOrg, sql } from "../db";
import { exigirContexto, exigirPapel } from "./contexto";
import { auditar } from "./organizacao";
import {
  esquecerCanal,
  salvarCanal,
  urlWebhookEvolution,
  verificarCanal,
  verificarCredenciais,
} from "../canais/fabrica";
import {
  ErroEmbeddedSignup,
  assinarWebhookWaba,
  gerarPin,
  registrarNumero,
  trocarCodePorToken,
} from "../canais/embedded-signup";
import { normalizarE164 } from "../dominio/telefone";

/**
 * Canais de WhatsApp da organização.
 *
 * O que faz este arquivo diferente de um CRUD:
 *
 * 1. Nunca gravamos um token sem antes perguntar ao provedor se ele funciona.
 *    Canal 'conectado' com credencial inválida é a pior falha possível aqui:
 *    a régua segue agendando, o worker segue marcando falha, e o cliente só
 *    descobre dias depois que nenhuma cobrança saiu.
 *
 * 2. Token nunca volta para fora. A leitura não seleciona `token_cif`; o
 *    segredo do webhook da Evolution aparece uma única vez, no retorno de
 *    quem acabou de conectar.
 *
 * 3. Desconectar não apaga. `conversa.canal_id` tem ON DELETE CASCADE — apagar
 *    o canal levaria junto o histórico de conversas daquele número. O que se
 *    faz é marcar 'desconectado' e zerar o token.
 */

export interface ConexaoDTO {
  id: string;
  nome: string;
  numero: string;
  provedor: "meta_cloud" | "evolution";
  status: "conectado" | "desconectado" | "pendente" | "erro";
  principal: boolean;
  qualidade: string | null;
  limiteDiario: number | null;
  ultimoErro: string | null;
  verificadoEm: Date | null;
  ultimaSync: Date | null;
  /** Mensagens enviadas no mês corrente por este número. */
  mensagensMes: number;
}

export interface PainelConexoes {
  conexoes: ConexaoDTO[];
  /** Inclusas no plano + extras compradas. */
  totais: number;
  /** Quantas ainda cabem sem virar cobrança extra. */
  disponiveis: number;
}

interface LinhaConexao {
  id: string;
  nome: string;
  numero_e164: string;
  provedor: "meta_cloud" | "evolution";
  status: ConexaoDTO["status"];
  principal: boolean;
  qualidade: string | null;
  limite_diario: number | null;
  ultimo_erro: string | null;
  verificado_em: Date | null;
  ultima_sync_em: Date | null;
  mensagens_mes: number;
}

// ---------------------------------------------------------------------------
// Leitura

export async function listarConexoes(): Promise<PainelConexoes> {
  const ctx = await exigirContexto();

  return comOrg(ctx.orgId, async (tx) => {
    const linhas = await tx<LinhaConexao[]>`
      SELECT c.id, c.nome, c.numero_e164, c.provedor, c.status, c.principal,
             c.qualidade, c.limite_diario, c.ultimo_erro,
             c.verificado_em, c.ultima_sync_em,
             /*
              * Contagem do mês corrente pelo relógio da organização: o cliente
              * compara este número com a fatura, e a fatura fecha no fuso dele.
              */
             COALESCE((
               SELECT count(*)
                 FROM mensagem m
                 JOIN conversa cv ON cv.id = m.conversa_id
                WHERE cv.canal_id = c.id
                  AND m.direcao = 'saida'
                  AND m.criado_em >= date_trunc(
                        'month', now() AT TIME ZONE o.fuso
                      ) AT TIME ZONE o.fuso
             ), 0)::int AS mensagens_mes
        FROM canal_whatsapp c
        JOIN organizacao o ON o.id = c.org_id
       WHERE c.status <> 'desconectado'
       ORDER BY c.principal DESC, c.criado_em
    `;

    const [plano] = await tx<{ totais: number }[]>`
      SELECT (COALESCE(p.conexoes_inclusas, 1) + COALESCE(a.conexoes_extras, 0))::int AS totais
        FROM organizacao o
        LEFT JOIN assinatura a ON a.org_id = o.id
        LEFT JOIN plano p ON p.id = a.plano_id
       WHERE o.id = ${ctx.orgId}
       LIMIT 1
    `;

    const totais = plano?.totais ?? 1;

    return {
      totais,
      disponiveis: Math.max(0, totais - linhas.length),
      conexoes: linhas.map(
        (l): ConexaoDTO => ({
          id: l.id,
          nome: l.nome,
          numero: l.numero_e164,
          provedor: l.provedor,
          status: l.status,
          principal: l.principal,
          qualidade: l.qualidade,
          limiteDiario: l.limite_diario,
          ultimoErro: l.ultimo_erro,
          verificadoEm: l.verificado_em,
          ultimaSync: l.ultima_sync_em,
          mensagensMes: l.mensagens_mes,
        }),
      ),
    };
  });
}

// ---------------------------------------------------------------------------
// Conectar

const entradaMeta = z.object({
  provedor: z.literal("meta_cloud"),
  nome: z.string().trim().min(2, "Dê um nome para reconhecer este número").max(60),
  numero: z.string().trim().min(8, "Informe o número do WhatsApp"),
  phoneNumberId: z.string().trim().min(5, "Informe o Phone Number ID da Meta"),
  wabaId: z.string().trim().optional(),
  token: z.string().trim().min(20, "O token de acesso parece curto demais"),
});

const entradaEvolution = z.object({
  provedor: z.literal("evolution"),
  nome: z.string().trim().min(2, "Dê um nome para reconhecer este número").max(60),
  numero: z.string().trim().min(8, "Informe o número do WhatsApp"),
  baseUrl: z.string().trim().url("A URL da instância precisa começar com http(s)://"),
  instancia: z.string().trim().min(1, "Informe o nome da instância"),
  token: z.string().trim().min(6, "Informe a API key da instância"),
});

export const entradaConexao = z.discriminatedUnion("provedor", [
  entradaMeta,
  entradaEvolution,
]);

export type EntradaConexao = z.infer<typeof entradaConexao>;

export class LimiteConexoesError extends Error {
  constructor(readonly totais: number) {
    super(
      `Seu plano permite ${totais} ${totais === 1 ? "número conectado" : "números conectados"}.`,
    );
    this.name = "LimiteConexoesError";
  }
}

export class CredencialInvalidaError extends Error {
  constructor(
    message: string,
    readonly codigo?: string,
  ) {
    super(message);
    this.name = "CredencialInvalidaError";
  }
}

export interface ConexaoCriada {
  canalId: string;
  numero: string;
  /** Só a Evolution devolve — e só nesta resposta. */
  webhookUrl: string | null;
  /**
   * Ressalva não bloqueante (ex.: registro de número na Cloud API falhou mas
   * a credencial em si é válida). `null` no caminho feliz.
   */
  aviso: string | null;
}

/**
 * Conecta um número: valida, testa contra o provedor e só então grava.
 *
 * A ordem importa. Testar depois de gravar deixaria uma janela em que o worker
 * poderia pegar a credencial ruim; e gravar depois de testar custa uma chamada
 * HTTP a mais que ninguém sente num fluxo manual como este.
 */
export async function conectarCanal(entrada: EntradaConexao): Promise<ConexaoCriada> {
  const ctx = await exigirPapel("admin", "conectar um número de WhatsApp");

  /*
   * O número digitado é só uma pista até confirmarmos com o provedor (ver
   * comentário mais abaixo — "confiamos no provedor"). Não recusamos a
   * conexão só porque a heurística de DDD brasileiro não reconheceu um
   * número estrangeiro sem '+' explícito (ex.: número de teste da Meta
   * colado sem o formato internacional): isso só limita a checagem
   * antecipada de limite do plano, que roda de novo com o número real do
   * provedor quando não dá para identificar o digitado.
   */
  const numeroDigitado = normalizarE164(entrada.numero);

  // Limite do plano: contamos antes de falar com o provedor para não fazer o
  // cliente esperar por uma chamada externa que vai ser descartada. Só dá
  // para checar cedo quando o número digitado foi reconhecido.
  if (numeroDigitado) {
    const painel = await listarConexoes();
    const jaExiste = painel.conexoes.some((c) => c.numero === numeroDigitado);
    if (!jaExiste && painel.disponiveis === 0) {
      throw new LimiteConexoesError(painel.totais);
    }
  }

  const verificacao = await verificarCredenciais({
    provedor: entrada.provedor,
    token: entrada.token,
    phoneNumberId: entrada.provedor === "meta_cloud" ? entrada.phoneNumberId : null,
    baseUrl: entrada.provedor === "evolution" ? entrada.baseUrl : null,
    instancia: entrada.provedor === "evolution" ? entrada.instancia : null,
  });

  if (!verificacao.ok) {
    throw new CredencialInvalidaError(verificacao.erro, verificacao.codigo);
  }

  /*
   * O provedor sabe qual número ele realmente controla. Se o cliente digitou
   * outro, gravar o que ele digitou faria as conversas entrarem num canal que
   * não corresponde ao remetente — e o webhook, que casa pelo phone_number_id,
   * nunca acharia esta linha. Confiamos no provedor.
   */
  const numeroReal = verificacao.numero ? normalizarE164(verificacao.numero) : null;
  const numeroFinal = numeroReal ?? numeroDigitado;

  if (!numeroFinal) {
    throw new CredencialInvalidaError("Número de WhatsApp inválido", "numero");
  }

  // Se não deu para checar o limite antes (número digitado não reconhecido),
  // checa agora com o número que o provedor confirmou.
  if (!numeroDigitado) {
    const painel = await listarConexoes();
    const jaExiste = painel.conexoes.some((c) => c.numero === numeroFinal);
    if (!jaExiste && painel.disponiveis === 0) {
      throw new LimiteConexoesError(painel.totais);
    }
  }

  const salvo = await comOrg(ctx.orgId, async (tx) => {
    const r = await salvarCanal(tx, {
      orgId: ctx.orgId,
      provedor: entrada.provedor,
      nome: entrada.nome,
      numeroE164: numeroFinal,
      wabaId: entrada.provedor === "meta_cloud" ? (entrada.wabaId ?? null) : null,
      phoneNumberId: entrada.provedor === "meta_cloud" ? entrada.phoneNumberId : null,
      baseUrl: entrada.provedor === "evolution" ? entrada.baseUrl : null,
      instancia: entrada.provedor === "evolution" ? entrada.instancia : null,
      token: entrada.token,
    });

    if (verificacao.qualidade || verificacao.limiteDiario) {
      await tx`
        UPDATE canal_whatsapp
           SET qualidade = ${verificacao.qualidade ?? null},
               limite_diario = ${verificacao.limiteDiario ?? null}
         WHERE id = ${r.canalId}
      `;
    }

    await auditar(tx, ctx, "canal.conectado", "canal_whatsapp", r.canalId, {
      provedor: entrada.provedor,
      numero: numeroFinal,
    });

    return r;
  });

  return {
    canalId: salvo.canalId,
    numero: numeroFinal,
    webhookUrl: salvo.webhookToken
      ? urlWebhookEvolution(salvo.canalId, salvo.webhookToken)
      : null,
    aviso: null,
  };
}

// ---------------------------------------------------------------------------
// Conectar via Embedded Signup (login com Facebook para Empresas)

const entradaConexaoEmbedded = z.object({
  nome: z.string().trim().min(2, "Dê um nome para reconhecer este número").max(60),
  code: z.string().trim().min(10, "Código de autorização ausente — tente conectar de novo"),
  wabaId: z
    .string()
    .trim()
    .min(1, "A Meta não informou a conta de WhatsApp Business — tente conectar de novo"),
  phoneNumberId: z
    .string()
    .trim()
    .min(1, "A Meta não informou o número escolhido — tente conectar de novo"),
});

export type EntradaConexaoEmbedded = z.infer<typeof entradaConexaoEmbedded>;
export { entradaConexaoEmbedded };

/**
 * Conecta um número pelo Embedded Signup: troca o `code` do pop-up por um
 * token, assina os webhooks da WABA, registra o número na Cloud API e só
 * então grava — mesma ordem "testa antes de salvar" do fluxo manual.
 *
 * O registro na Cloud API (`registrarNumero`) é a única etapa tratada como
 * ressalva em vez de erro fatal: um número que a agência já configurou antes
 * (migrado de outro BSP, verificação em duas etapas já ligada por outra
 * pessoa) pode recusar o PIN que a gente gerou mesmo com credencial válida —
 * bloquear a conexão inteira por isso seria pior que avisar e deixar o
 * cliente testar o envio.
 */
export async function conectarCanalEmbedded(
  entradaBruta: EntradaConexaoEmbedded,
): Promise<ConexaoCriada> {
  const ctx = await exigirPapel("admin", "conectar um número de WhatsApp");
  const entrada = entradaConexaoEmbedded.parse(entradaBruta);

  const token = await trocarCodePorToken(entrada.code).catch((erro) => {
    if (erro instanceof ErroEmbeddedSignup) {
      throw new CredencialInvalidaError(erro.message, erro.codigo);
    }
    throw erro;
  });

  const verificacao = await verificarCredenciais({
    provedor: "meta_cloud",
    token,
    phoneNumberId: entrada.phoneNumberId,
    baseUrl: null,
    instancia: null,
  });

  if (!verificacao.ok) {
    throw new CredencialInvalidaError(verificacao.erro, verificacao.codigo);
  }

  const numero = verificacao.numero ? normalizarE164(verificacao.numero) : null;
  if (!numero) {
    throw new CredencialInvalidaError(
      "A Meta não devolveu o número deste WhatsApp. Tente conectar de novo.",
      "numero",
    );
  }

  const painel = await listarConexoes();
  const jaExiste = painel.conexoes.some((c) => c.numero === numero);
  if (!jaExiste && painel.disponiveis === 0) {
    throw new LimiteConexoesError(painel.totais);
  }

  await assinarWebhookWaba(token, entrada.wabaId).catch((erro) => {
    if (erro instanceof ErroEmbeddedSignup) {
      throw new CredencialInvalidaError(erro.message, erro.codigo);
    }
    throw erro;
  });

  const pin = gerarPin();
  let aviso: string | null = null;
  try {
    await registrarNumero(token, entrada.phoneNumberId, pin);
  } catch (erro) {
    aviso =
      erro instanceof ErroEmbeddedSignup
        ? `Conexão feita, mas o registro automático do número falhou: ${erro.message} Se o envio não funcionar, procure o suporte.`
        : "Conexão feita, mas não foi possível confirmar o registro do número. Se o envio não funcionar, procure o suporte.";
  }

  const salvo = await comOrg(ctx.orgId, async (tx) => {
    const r = await salvarCanal(tx, {
      orgId: ctx.orgId,
      provedor: "meta_cloud",
      nome: entrada.nome,
      numeroE164: numero,
      wabaId: entrada.wabaId,
      phoneNumberId: entrada.phoneNumberId,
      baseUrl: null,
      instancia: null,
      token,
      pin: aviso ? null : pin,
    });

    if (verificacao.qualidade || verificacao.limiteDiario) {
      await tx`
        UPDATE canal_whatsapp
           SET qualidade = ${verificacao.qualidade ?? null},
               limite_diario = ${verificacao.limiteDiario ?? null}
         WHERE id = ${r.canalId}
      `;
    }

    await auditar(tx, ctx, "canal.conectado", "canal_whatsapp", r.canalId, {
      provedor: "meta_cloud",
      numero,
      via: "embedded_signup",
    });

    return r;
  });

  return {
    canalId: salvo.canalId,
    numero,
    webhookUrl: null,
    aviso,
  };
}

// ---------------------------------------------------------------------------
// Manutenção

/** Botão "testar conexão" da tela. Devolve a frase que o cliente vai ler. */
export async function testarConexao(
  canalId: string,
): Promise<{ ok: boolean; mensagem: string }> {
  const ctx = await exigirPapel("atendente", "testar a conexão");

  const resultado = await verificarCanal(ctx.orgId, canalId);

  if (!resultado.ok) return { ok: false, mensagem: resultado.erro };

  const partes = ["Conexão funcionando"];
  if (resultado.numero) partes.push(`número ${resultado.numero}`);
  if (resultado.qualidade) partes.push(`qualidade ${resultado.qualidade}`);
  return { ok: true, mensagem: `${partes.join(" · ")}.` };
}

/**
 * Desconecta o número: zera o token e para de disparar por ele.
 *
 * Os disparos já agendados que apontavam para este canal continuam na fila —
 * o canal é resolvido no momento do envio, então eles passam a usar o número
 * principal que sobrar. Se não sobrar nenhum, falham com "nenhum canal
 * conectado", que é a mensagem certa para a tela.
 */
export async function desconectarCanal(canalId: string): Promise<void> {
  const ctx = await exigirPapel("admin", "desconectar um número");

  await comOrg(ctx.orgId, async (tx) => {
    const [linha] = await tx<{ nome: string; principal: boolean }[]>`
      UPDATE canal_whatsapp
         SET status = 'desconectado', token_cif = NULL, principal = false,
             webhook_token_hash = NULL, ultimo_erro = NULL,
             atualizado_em = now()
       WHERE id = ${canalId} AND org_id = ${ctx.orgId}
       RETURNING nome, principal
    `;

    if (!linha) throw new Error("Conexão não encontrada");

    // Ficar sem principal deixaria `credenciaisDaOrg` escolhendo pelo
    // `criado_em` — funciona, mas o cliente perderia o controle de qual número
    // fala em nome dele. Promovemos o mais antigo que ainda está de pé.
    if (linha.principal) {
      await tx`
        UPDATE canal_whatsapp
           SET principal = true, atualizado_em = now()
         WHERE id = (
                 SELECT id FROM canal_whatsapp
                  WHERE org_id = ${ctx.orgId} AND status = 'conectado'
                  ORDER BY criado_em
                  LIMIT 1
               )
      `;
    }

    await auditar(tx, ctx, "canal.desconectado", "canal_whatsapp", canalId, {
      nome: linha.nome,
    });
  });

  esquecerCanal(ctx.orgId);
}

/** Qual número fala em nome da organização quando a régua não escolhe. */
export async function definirPrincipal(canalId: string): Promise<void> {
  const ctx = await exigirPapel("admin", "definir o número principal");

  await comOrg(ctx.orgId, async (tx) => {
    // Rebaixa antes de promover: `ux_canal_principal` é um índice único
    // parcial, verificado a cada statement.
    await tx`
      UPDATE canal_whatsapp
         SET principal = false, atualizado_em = now()
       WHERE org_id = ${ctx.orgId} AND principal AND id <> ${canalId}
    `;

    const [linha] = await tx<{ id: string }[]>`
      UPDATE canal_whatsapp
         SET principal = true, atualizado_em = now()
       WHERE id = ${canalId} AND org_id = ${ctx.orgId}
         AND status = 'conectado'
       RETURNING id
    `;

    if (!linha) throw new Error("Só um número conectado pode ser o principal");

    await auditar(tx, ctx, "canal.principal", "canal_whatsapp", canalId, {});
  });

  esquecerCanal(ctx.orgId);
}

/** Renomeia — só rótulo interno, o provedor não sabe deste nome. */
export async function renomearCanal(canalId: string, nome: string): Promise<void> {
  const ctx = await exigirPapel("admin", "renomear um número");

  const limpo = nome.trim();
  if (limpo.length < 2) throw new Error("Nome muito curto");

  await comOrg(ctx.orgId, async (tx) => {
    await tx`
      UPDATE canal_whatsapp
         SET nome = ${limpo.slice(0, 60)}, atualizado_em = now()
       WHERE id = ${canalId} AND org_id = ${ctx.orgId}
    `;
  });
}

/**
 * Canais que o worker deveria conseguir usar mas estão quebrados.
 *
 * Usado pelo cron: um canal em erro é silencioso — ninguém abre a tela de
 * conexões todo dia — e cada hora parado é cobrança que não sai.
 */
export async function canaisComProblema(): Promise<
  { orgId: string; canalId: string; nome: string; erro: string | null }[]
> {
  const linhas = await sql<
    { org_id: string; id: string; nome: string; ultimo_erro: string | null }[]
  >`
    SELECT org_id, id, nome, ultimo_erro
      FROM canal_whatsapp
     WHERE status = 'erro'
       AND atualizado_em > now() - interval '7 days'
     ORDER BY atualizado_em DESC
     LIMIT 200
  `;

  return linhas.map((l) => ({
    orgId: l.org_id,
    canalId: l.id,
    nome: l.nome,
    erro: l.ultimo_erro,
  }));
}
