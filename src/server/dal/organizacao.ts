import "server-only";

import { z } from "zod";

import { sql, comOrg, type Transacao } from "@/server/db";
import { conferirSenha, gerarHashSenha, precisaRehash, validarSenha } from "@/server/seguranca/senha";
import { normalizarE164 } from "@/server/dominio/telefone";
import { exigirContexto, exigirPapel, type Contexto } from "./contexto";

/**
 * Cadastro, login e configuração da organização.
 *
 * O fluxo de entrada é o coração do produto: o cliente se registra sozinho,
 * responde 4 perguntas e sai com o robô funcionando. Tudo aqui é pensado para
 * que ele nunca fique olhando para uma tela vazia.
 */

// ---------------------------------------------------------------------------
// Cadastro
// ---------------------------------------------------------------------------

export const EntradaRegistro = z.object({
  nome: z.string().trim().min(2, "Diga seu nome.").max(120),
  email: z.string().trim().toLowerCase().email("E-mail inválido."),
  senha: z.string().min(1, "Escolha uma senha."),
  nomeEmpresa: z.string().trim().min(2, "Diga o nome do seu negócio.").max(160),
  telefone: z.string().trim().optional(),
});
export type EntradaRegistro = z.infer<typeof EntradaRegistro>;

export class EmailEmUsoError extends Error {
  constructor() {
    super("Já existe uma conta com esse e-mail.");
    this.name = "EmailEmUsoError";
  }
}

export interface ResultadoRegistro {
  usuarioId: string;
  orgId: string;
}

/**
 * Cria usuário + organização + vínculo de dono + trial + régua padrão.
 *
 * Tudo em uma transação: se qualquer parte falhar, não sobra usuário órfão sem
 * empresa (que é o pior estado possível — a pessoa consegue logar e não tem
 * nada, e nem consegue se cadastrar de novo porque o e-mail já existe).
 */
export async function registrar(
  entrada: EntradaRegistro,
): Promise<ResultadoRegistro> {
  const erroSenha = validarSenha(entrada.senha);
  if (erroSenha) throw new Error(erroSenha);

  // Hash ANTES de abrir a transação: scrypt segura a thread por ~100ms e não
  // faz sentido manter uma conexão do pool e locks abertos durante isso.
  const senhaHash = await gerarHashSenha(entrada.senha);
  const telefone = normalizarE164(entrada.telefone);

  return sql.begin(async (tx) => {
    const [existente] = await tx`
      SELECT id FROM usuario WHERE email = ${entrada.email}
    `;
    if (existente) throw new EmailEmUsoError();

    const [usuario] = await tx<{ id: string }[]>`
      INSERT INTO usuario (email, senha_hash, nome, telefone)
      VALUES (${entrada.email}, ${senhaHash}, ${entrada.nome}, ${telefone})
      RETURNING id
    `;

    const slug = await slugDisponivel(tx, entrada.nomeEmpresa);

    const [org] = await tx<{ id: string }[]>`
      INSERT INTO organizacao (slug, nome_empresa)
      VALUES (${slug}, ${entrada.nomeEmpresa})
      RETURNING id
    `;

    // A partir daqui as tabelas (assinatura, movimento_credito, regua...) têm
    // RLS com WITH CHECK (org_id = app_org()). A organização acabou de nascer
    // nesta mesma transação, então precisamos armar o contexto agora — sem
    // isso app_org() fica NULL e todo INSERT seguinte é barrado pela policy.
    await tx`SELECT set_config('app.org_id', ${org.id}, true)`;

    await tx`
      INSERT INTO membro (org_id, usuario_id, papel)
      VALUES (${org.id}, ${usuario.id}, 'dono')
    `;

    // Trial no plano mais completo, não no mais barato. O objetivo do teste é
    // a pessoa ver a cobrança automática funcionando — que é o que converte.
    // Depois de 7 dias ela escolhe o plano; se não escolher, cai para expirada.
    const [{ valor: diasTrial }] = await tx<{ valor: string }[]>`
      SELECT valor FROM parametro WHERE chave = 'trial_dias'
    `;

    await tx`
      INSERT INTO assinatura (org_id, plano_id, periodicidade, status, preco_contratado, inicia_em, expira_em, renovacao_automatica)
      SELECT ${org.id}, 'completo', 'mensal', 'trial', p.preco_mensal,
             now(), now() + make_interval(days => ${Number(diasTrial)}), false
        FROM plano p WHERE p.id = 'completo'
    `;

    // Créditos de cortesia do trial: sem isso a IA não responde nada no teste
    // e a pessoa conclui que "não funciona". O trigger tg_aplicar_credito
    // atualiza organizacao.saldo_creditos sozinho.
    await tx`
      INSERT INTO movimento_credito (org_id, tipo, quantidade, origem_tipo, idempotencia, expira_em)
      VALUES (${org.id}, 'bonus_plano', 500, 'trial', ${`trial:${org.id}`},
              now() + make_interval(days => ${Number(diasTrial)}))
    `;

    await criarReguaPadrao(tx, org.id);

    return { usuarioId: usuario.id, orgId: org.id };
  }) as Promise<ResultadoRegistro>;
}

/**
 * Slug legível e único: "clinica-vitalis", "clinica-vitalis-2"...
 *
 * Serve para URL e para o cliente se reconhecer. A unicidade é garantida pelo
 * UNIQUE da coluna; o loop aqui é só para não devolver erro feio ao usuário.
 */
async function slugDisponivel(tx: Transacao, nome: string): Promise<string> {
  const base =
    nome
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // tira acento: "Vitália" -> "Vitalia"
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "empresa";

  for (let i = 0; i < 50; i++) {
    const tentativa = i === 0 ? base : `${base}-${i + 1}`;
    const [ocupado] = await tx`SELECT 1 FROM organizacao WHERE slug = ${tentativa}`;
    if (!ocupado) return tentativa;
  }
  // Improvável, mas melhor um slug feio do que erro no cadastro.
  return `${base}-${Date.now().toString(36)}`;
}

/**
 * Régua de cobrança que já vem pronta.
 *
 * Esta é a régua que a IA "escreveu sozinha" na tela de boas-vindas. Os textos
 * seguem o que funciona na prática em cobrança de pequeno negócio no Brasil:
 * lembrete gentil antes, cobrança seca no dia, e só depois firmeza — nunca
 * ameaça. Os offsets são negativos antes do vencimento e positivos depois.
 */
async function criarReguaPadrao(tx: Transacao, orgId: string): Promise<void> {
  const [regua] = await tx<{ id: string }[]>`
    INSERT INTO regua (org_id, nome, descricao, ativa, aplicar_a, padrao,
                       pausar_ao_responder, pausar_ao_pagar)
    VALUES (${orgId}, 'Régua padrão',
            'Lembra antes, cobra no dia e insiste com educação depois.',
            true, 'todas', true, true, true)
    RETURNING id
  `;

  const etapas = [
    {
      ordem: 1,
      referencia: "vencimento",
      offset_dias: -3,
      hora: "09:00",
      condicao: "se_nao_pago",
      acao: "enviar_whatsapp",
      mensagem:
        "Oi {{nome}}! Passando pra lembrar que {{descricao}} vence dia {{vencimento}}, no valor de {{valor}}. Qualquer coisa é só me chamar aqui. 🙂",
      anexar_pix: true,
    },
    {
      ordem: 2,
      referencia: "vencimento",
      offset_dias: 0,
      hora: "09:00",
      condicao: "se_nao_pago",
      acao: "enviar_whatsapp",
      mensagem:
        "Bom dia, {{nome}}! Hoje é o vencimento de {{descricao}} ({{valor}}). Segue o PIX pra facilitar. Se já pagou, pode ignorar. 👍",
      anexar_pix: true,
    },
    {
      ordem: 3,
      referencia: "vencimento",
      offset_dias: 3,
      hora: "10:00",
      condicao: "se_nao_pago",
      acao: "enviar_whatsapp",
      mensagem:
        "Oi {{nome}}, tudo bem? {{descricao}} venceu dia {{vencimento}} e ainda consta em aberto ({{valor}}). Consegue acertar hoje? Se precisar, dá pra dividir.",
      anexar_pix: true,
    },
    {
      ordem: 4,
      referencia: "vencimento",
      offset_dias: 7,
      hora: "10:00",
      condicao: "se_nao_pago",
      acao: "notificar_voce",
      mensagem:
        "{{nome}} está há {{dias_atraso}} dias em atraso ({{valor}}) e não respondeu as últimas mensagens.",
      anexar_pix: false,
    },
  ];

  for (const e of etapas) {
    await tx`
      INSERT INTO regua_etapa (regua_id, ordem, referencia, offset_dias, hora,
                               condicao, acao, mensagem, anexar_pix, ativa)
      VALUES (${regua.id}, ${e.ordem}, ${e.referencia}, ${e.offset_dias},
              ${e.hora}, ${e.condicao}, ${e.acao}, ${e.mensagem},
              ${e.anexar_pix}, true)
    `;
  }
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

/**
 * Confere e-mail e senha.
 *
 * Devolve `null` tanto para e-mail inexistente quanto para senha errada — quem
 * chama não deve conseguir distinguir os casos, e a mensagem para o usuário é
 * sempre a mesma. Diferenciar transformaria a tela de login em um verificador
 * de "essa pessoa é cliente do AutoFlow?".
 */
export async function autenticar(
  email: string,
  senha: string,
): Promise<{ usuarioId: string } | null> {
  const [usuario] = await sql<{ id: string; senha_hash: string | null }[]>`
    SELECT id, senha_hash FROM usuario WHERE email = ${email.trim().toLowerCase()}
  `;

  if (!usuario?.senha_hash) {
    // Gasta o mesmo tempo de um scrypt real. Sem isso, "e-mail não existe"
    // responde em 2ms e "senha errada" em 100ms — dá para enumerar a base de
    // clientes só cronometrando as respostas.
    await gerarHashSenha(senha);
    return null;
  }

  const ok = await conferirSenha(senha, usuario.senha_hash);
  if (!ok) return null;

  // Único momento em que temos a senha em claro de alguém já cadastrado:
  // aproveitamos para subir o custo do hash se os parâmetros mudaram.
  if (precisaRehash(usuario.senha_hash)) {
    const novo = await gerarHashSenha(senha);
    await sql`UPDATE usuario SET senha_hash = ${novo} WHERE id = ${usuario.id}`;
  }

  return { usuarioId: usuario.id };
}

export async function trocarSenha(
  usuarioId: string,
  senhaAtual: string,
  senhaNova: string,
): Promise<void> {
  const erro = validarSenha(senhaNova);
  if (erro) throw new Error(erro);

  const [usuario] = await sql<{ senha_hash: string | null }[]>`
    SELECT senha_hash FROM usuario WHERE id = ${usuarioId}
  `;
  if (!usuario?.senha_hash || !(await conferirSenha(senhaAtual, usuario.senha_hash))) {
    throw new Error("Senha atual incorreta.");
  }

  const hash = await gerarHashSenha(senhaNova);
  await sql`UPDATE usuario SET senha_hash = ${hash}, atualizado_em = now() WHERE id = ${usuarioId}`;
}

// ---------------------------------------------------------------------------
// Configuração da organização
// ---------------------------------------------------------------------------

export interface ConfigOrg {
  id: string;
  slug: string;
  nomeEmpresa: string;
  segmento: string | null;
  fuso: string;
  nomeAtendente: string;
  tom: string;
  objetivos: string[];
  instrucoesExtra: string | null;
  horarioInicio: string;
  horarioFim: string;
  diasSemana: number[];
  whatsappPessoal: string | null;
  notificarNovoAgendamento: boolean;
  notificarPagamento: boolean;
  notificarSemResposta: boolean;
  chavePix: string | null;
  onboardingCompleto: boolean;
  saldoCreditos: number;
}

export async function buscarConfig(): Promise<ConfigOrg> {
  const ctx = await exigirContexto();

  return comOrg(ctx.orgId, async (tx) => {
    const [o] = await tx<
      {
        id: string;
        slug: string;
        nome_empresa: string;
        segmento: string | null;
        fuso: string;
        nome_atendente: string;
        tom: string;
        objetivos: string[];
        instrucoes_extra: string | null;
        horario_inicio: string;
        horario_fim: string;
        dias_semana: number[];
        whatsapp_pessoal: string | null;
        notificar_novo_agendamento: boolean;
        notificar_pagamento: boolean;
        notificar_sem_resposta: boolean;
        chave_pix: string | null;
        onboarding_completo: boolean;
        saldo_creditos: number;
      }[]
    >`SELECT * FROM organizacao WHERE id = ${ctx.orgId}`;

    return {
      id: o.id,
      slug: o.slug,
      nomeEmpresa: o.nome_empresa,
      segmento: o.segmento,
      fuso: o.fuso,
      nomeAtendente: o.nome_atendente,
      tom: o.tom,
      objetivos: o.objetivos ?? [],
      instrucoesExtra: o.instrucoes_extra,
      // `time` volta como "09:00:00"; a UI usa <input type="time">, que quer "09:00".
      horarioInicio: o.horario_inicio.slice(0, 5),
      horarioFim: o.horario_fim.slice(0, 5),
      diasSemana: o.dias_semana ?? [],
      whatsappPessoal: o.whatsapp_pessoal,
      notificarNovoAgendamento: o.notificar_novo_agendamento,
      notificarPagamento: o.notificar_pagamento,
      notificarSemResposta: o.notificar_sem_resposta,
      chavePix: o.chave_pix,
      onboardingCompleto: o.onboarding_completo,
      saldoCreditos: Number(o.saldo_creditos),
    };
  });
}

export const EntradaOnboarding = z.object({
  segmento: z.string().trim().max(60).optional(),
  nomeAtendente: z.string().trim().min(2, "Dê um nome ao seu atendente.").max(60),
  tom: z.enum(["amigavel", "profissional", "direto"]),
  objetivos: z.array(z.string().max(40)).max(10).default([]),
  instrucoesExtra: z.string().trim().max(4000).optional(),
  horarioInicio: z.string().regex(/^\d{2}:\d{2}$/),
  horarioFim: z.string().regex(/^\d{2}:\d{2}$/),
  diasSemana: z.array(z.number().int().min(0).max(6)).min(1, "Escolha ao menos um dia."),
  fuso: z.string().trim().min(3).default("America/Sao_Paulo"),
  whatsappPessoal: z.string().trim().optional(),
  chavePix: z.string().trim().max(120).optional(),
});
export type EntradaOnboarding = z.infer<typeof EntradaOnboarding>;

/**
 * Grava as respostas do onboarding e marca a organização como pronta.
 *
 * `onboarding_completo` é o que libera o painel: enquanto for false, o layout
 * empurra o usuário de volta para o passo a passo. É melhor do que deixar
 * entrar e ver um painel vazio sem saber o que fazer.
 */
export async function salvarOnboarding(
  entrada: EntradaOnboarding,
): Promise<void> {
  const ctx = await exigirPapel("admin", "configurar a organização");

  const whats = normalizarE164(entrada.whatsappPessoal);

  await comOrg(ctx.orgId, async (tx) => {
    await tx`
      UPDATE organizacao SET
        segmento         = ${entrada.segmento ?? null},
        nome_atendente   = ${entrada.nomeAtendente},
        tom              = ${entrada.tom},
        objetivos        = ${entrada.objetivos},
        instrucoes_extra = ${entrada.instrucoesExtra ?? null},
        horario_inicio   = ${entrada.horarioInicio}::time,
        horario_fim      = ${entrada.horarioFim}::time,
        dias_semana      = ${entrada.diasSemana},
        fuso             = ${entrada.fuso},
        whatsapp_pessoal = ${whats},
        chave_pix        = ${entrada.chavePix ?? null},
        onboarding_completo = true,
        atualizado_em    = now()
      WHERE id = ${ctx.orgId}
    `;

    await auditar(tx, ctx, "onboarding.concluido", "organizacao", ctx.orgId, null);
  });
}

export const EntradaConfig = EntradaOnboarding.partial().extend({
  nomeEmpresa: z.string().trim().min(2).max(160).optional(),
  notificarNovoAgendamento: z.boolean().optional(),
  notificarPagamento: z.boolean().optional(),
  notificarSemResposta: z.boolean().optional(),
});
export type EntradaConfig = z.infer<typeof EntradaConfig>;

/**
 * Atualização parcial das configurações.
 *
 * Monta o SET dinamicamente a partir só das chaves presentes. O mapa fixo de
 * campo→coluna é o que impede o cliente de escrever em coluna arbitrária: nada
 * que não esteja nesta lista chega no SQL.
 */
export async function salvarConfig(entrada: EntradaConfig): Promise<void> {
  const ctx = await exigirPapel("admin", "alterar configurações");

  const mapa: Record<string, { coluna: string; valor: unknown }> = {};
  const def = (chave: keyof EntradaConfig, coluna: string, valor: unknown) => {
    if (entrada[chave] !== undefined) mapa[coluna] = { coluna, valor };
  };

  def("nomeEmpresa", "nome_empresa", entrada.nomeEmpresa);
  def("segmento", "segmento", entrada.segmento ?? null);
  def("nomeAtendente", "nome_atendente", entrada.nomeAtendente);
  def("tom", "tom", entrada.tom);
  def("objetivos", "objetivos", entrada.objetivos);
  def("instrucoesExtra", "instrucoes_extra", entrada.instrucoesExtra ?? null);
  def("diasSemana", "dias_semana", entrada.diasSemana);
  def("fuso", "fuso", entrada.fuso);
  def("chavePix", "chave_pix", entrada.chavePix ?? null);
  def("notificarNovoAgendamento", "notificar_novo_agendamento", entrada.notificarNovoAgendamento);
  def("notificarPagamento", "notificar_pagamento", entrada.notificarPagamento);
  def("notificarSemResposta", "notificar_sem_resposta", entrada.notificarSemResposta);

  if (Object.keys(mapa).length === 0 && !entrada.horarioInicio && !entrada.horarioFim && !entrada.whatsappPessoal) {
    return;
  }

  await comOrg(ctx.orgId, async (tx) => {
    for (const { coluna, valor } of Object.values(mapa)) {
      await tx`
        UPDATE organizacao SET ${tx(coluna)} = ${valor as never}, atualizado_em = now()
         WHERE id = ${ctx.orgId}
      `;
    }
    // Colunas `time` e telefone precisam de cast/normalização própria.
    if (entrada.horarioInicio) {
      await tx`UPDATE organizacao SET horario_inicio = ${entrada.horarioInicio}::time WHERE id = ${ctx.orgId}`;
    }
    if (entrada.horarioFim) {
      await tx`UPDATE organizacao SET horario_fim = ${entrada.horarioFim}::time WHERE id = ${ctx.orgId}`;
    }
    if (entrada.whatsappPessoal !== undefined) {
      const w = normalizarE164(entrada.whatsappPessoal);
      await tx`UPDATE organizacao SET whatsapp_pessoal = ${w} WHERE id = ${ctx.orgId}`;
    }

    await auditar(tx, ctx, "config.alterada", "organizacao", ctx.orgId, {
      campos: Object.keys(mapa),
    });
  });
}

// ---------------------------------------------------------------------------
// Auditoria
// ---------------------------------------------------------------------------

/**
 * Registra quem fez o quê.
 *
 * Em produto que manda mensagem em nome do cliente, "quem apagou a régua?" e
 * "quem disparou essa cobrança?" viram perguntas reais no suporte. Sai barato
 * gravar desde o começo e é impossível recuperar depois.
 */
export async function auditar(
  tx: Transacao,
  ctx: Pick<Contexto, "orgId" | "usuarioId">,
  acao: string,
  entidade: string,
  entidadeId: string | null,
  dados: unknown,
): Promise<void> {
  // A coluna "dados" é NOT NULL — quando o chamador não tem detalhes extras
  // para registrar (ex.: dados === null/undefined), gravamos um objeto vazio
  // em vez de null para não estourar a constraint e derrubar a ação inteira.
  await tx`
    INSERT INTO log_auditoria (org_id, usuario_id, acao, entidade, entidade_id, dados)
    VALUES (${ctx.orgId}, ${ctx.usuarioId}, ${acao}, ${entidade},
            ${entidadeId}, ${JSON.stringify(dados ?? {})}::jsonb)
  `;
}
