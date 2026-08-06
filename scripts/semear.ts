/**
 * Semeia um tenant de demonstração no Postgres local e imprime o cookie de
 * sessão pronto para usar no navegador (ou no curl do smoke).
 *
 * Não é fixture de teste: o teste de integração cria e derruba os próprios
 * dados. Isto aqui existe para ter o que olhar na tela durante o
 * desenvolvimento — painel, caixa de entrada, agenda e cobranças com volume
 * parecido com o de um cliente real de verdade.
 *
 * Roda como superusuário (DATABASE_URL_MIGRACAO) porque precisa escrever em
 * várias organizações sem armar `app.org_id` a cada tabela — é o mesmo papel
 * das migrações, e nunca o papel da aplicação.
 *
 * Uso:
 *   npm run db:semear
 */
import { createHmac, randomBytes } from "node:crypto";

import postgres from "postgres";

import {
  materializarDisparos,
  type EtapaRegua,
} from "../src/server/dominio/regua";
import { cifrar, versaoAtual } from "../src/server/seguranca/cripto";
import { gerarHashSenha } from "../src/server/seguranca/senha";

const EMAIL = process.env.SEMENTE_EMAIL ?? "demo@autoflow.com.br";
const SENHA = process.env.SEMENTE_SENHA ?? "demo12345678";
const SLUG = process.env.SEMENTE_SLUG ?? "clinica-demo";
const FUSO = "America/Sao_Paulo";

const url =
  process.env.DATABASE_URL_MIGRACAO ??
  process.env.DATABASE_URL_DIRETA ??
  process.env.DATABASE_URL;

if (!url) {
  throw new Error("DATABASE_URL_MIGRACAO (ou DATABASE_URL) não configurada");
}

const segredo = process.env.AUTH_SECRET;
if (!segredo || segredo.length < 32) {
  throw new Error("AUTH_SECRET não configurado (mínimo 32 caracteres)");
}

const sql = postgres(url, { onnotice: () => {}, types: { bigint: postgres.BigInt } });

/** Mesma derivação de `hashToken` — o cookie precisa casar com o que a DAL lê. */
function hashToken(token: string): string {
  return createHmac("sha256", segredo!).update(token).digest("hex");
}

/** Data relativa a agora, em horas, para o dado não envelhecer no banco. */
function emHoras(h: number): Date {
  return new Date(Date.now() + h * 3_600_000);
}

/** Hoje no fuso do tenant, com hora cravada — evita agendamento fora do expediente. */
function hojeAs(diaOffset: number, hora: number, minuto = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + diaOffset);
  d.setHours(hora, minuto, 0, 0);
  return d;
}

function dataISO(diaOffset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + diaOffset);
  return d.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  console.log(`Semeando ${SLUG} (${EMAIL})…`);

  // Recomeça do zero: apagar a organização leva junto contatos, conversas,
  // cobranças e agendamentos pelo ON DELETE CASCADE.
  await sql`DELETE FROM organizacao WHERE slug = ${SLUG}`;

  const senhaHash = await gerarHashSenha(SENHA);

  const [usuario] = await sql<{ id: string }[]>`
    INSERT INTO usuario (email, senha_hash, nome, telefone, email_verificado_em)
    VALUES (${EMAIL}, ${senhaHash}, 'Gustavo Demo', '+5511988887777', now())
    ON CONFLICT (email) DO UPDATE
      SET senha_hash = EXCLUDED.senha_hash, nome = EXCLUDED.nome
    RETURNING id
  `;

  const [org] = await sql<{ id: string }[]>`
    INSERT INTO organizacao (
      slug, nome_empresa, segmento, fuso, nome_atendente, tom, objetivos,
      instrucoes_extra, horario_inicio, horario_fim, dias_semana,
      whatsapp_pessoal, chave_pix, onboarding_completo
    )
    VALUES (
      ${SLUG}, 'Clínica Vitalis', 'Saúde e bem-estar', ${FUSO},
      'Sofia', 'amigavel', ARRAY['atendimento','cobranca','agendamento']::feature[],
      'Primeira consulta custa R$ 150. Não atendemos convênio. Estacionamento gratuito.',
      '08:00', '19:00', ARRAY[1,2,3,4,5,6]::smallint[],
      '+5511988887777', 'contato@vitalis.com.br', true
    )
    RETURNING id
  `;

  await sql`
    INSERT INTO membro (org_id, usuario_id, papel)
    VALUES (${org.id}, ${usuario.id}, 'dono')
  `;

  // ---------------------------------------------------------------- assinatura
  const [plano] = await sql<{ id: string }[]>`
    SELECT id FROM plano WHERE ativo ORDER BY ordem LIMIT 1 OFFSET 1
  `;
  const [preco] = await sql<{ preco_total: bigint }[]>`
    SELECT preco_total FROM plano_preco
    WHERE plano_id = ${plano.id} AND periodicidade = 'mensal'
  `;

  await sql`
    INSERT INTO assinatura (
      org_id, plano_id, periodicidade, status, preco_contratado,
      inicia_em, expira_em, renovacao_automatica
    )
    VALUES (
      ${org.id}, ${plano.id}, 'mensal', 'ativa', ${preco.preco_total},
      ${emHoras(-24 * 12)}, ${emHoras(24 * 18)}, true
    )
  `;

  // Créditos: bônus do plano + consumo espalhado, para o gráfico ter forma.
  // `saldo_apos` é conferido por trigger no banco, então a soma tem que fechar.
  let saldo = 0;
  const movimentos: {
    tipo: string;
    qtd: number;
    origem: string;
    dias: number;
  }[] = [
    { tipo: "bonus_plano", qtd: 3000, origem: "assinatura", dias: -12 },
    { tipo: "compra", qtd: 1000, origem: "pagamento", dias: -6 },
  ];
  for (let d = 12; d >= 0; d--) {
    movimentos.push({
      tipo: "consumo",
      qtd: -(40 + Math.round(Math.sin(d) * 25 + d * 3)),
      origem: "uso_ia",
      dias: -d,
    });
  }
  movimentos.sort((a, b) => a.dias - b.dias);

  for (const [i, m] of movimentos.entries()) {
    saldo += m.qtd;
    await sql`
      INSERT INTO movimento_credito (
        org_id, tipo, quantidade, saldo_apos, origem_tipo, idempotencia, criado_em
      )
      VALUES (
        ${org.id}, ${m.tipo}::tipo_movimento, ${m.qtd}, ${saldo},
        ${m.origem}, ${`semente-${i}`}, ${emHoras(m.dias * 24)}
      )
    `;
  }

  // -------------------------------------------------------------------- canal
  // O token é cifrado com o mesmo envelope da aplicação (AAD `canal:<org_id>`):
  // um canal 'conectado' sem `token_cif` esbarra em `ck_canal_credenciais`, e a
  // fábrica precisa conseguir decifrar o que está aqui — token falso, envelope
  // real, senão o smoke passaria por um caminho que produção não usa.
  const [canal] = await sql<{ id: string }[]>`
    INSERT INTO canal_whatsapp (
      org_id, provedor, nome, numero_e164, status, principal,
      waba_id, phone_number_id, token_cif, chave_versao,
      qualidade, limite_diario, verificado_em
    )
    VALUES (
      ${org.id}, 'meta_cloud', 'Recepção', '+5511933334444', 'conectado', true,
      '102938475610293', ${`demo-${randomBytes(4).toString("hex")}`},
      ${cifrar(`demo-token-${randomBytes(8).toString("hex")}`, `canal:${org.id}`)},
      ${versaoAtual()},
      'GREEN', 1000, now()
    )
    RETURNING id
  `;

  // ------------------------------------------------------------------ serviços
  const servicos = await sql<{ id: string; nome: string }[]>`
    INSERT INTO servico (org_id, nome, duracao_min, preco, intervalo_min)
    VALUES
      (${org.id}, 'Consulta inicial', 60, 15000, 10),
      (${org.id}, 'Retorno', 30, 9000, 10),
      (${org.id}, 'Avaliação nutricional', 45, 12000, 10)
    RETURNING id, nome
  `;

  // ------------------------------------------------------------------ contatos
  const pessoas = [
    ["Maria Souza", "+5511991110001", "maria@exemplo.com"],
    ["João Pereira", "+5511991110002", "joao@exemplo.com"],
    ["Fernanda Reis", "+5511991110003", "fernanda@exemplo.com"],
    ["Carlos Antunes", "+5511991110004", null],
    ["Patrícia Lima", "+5511991110005", "patricia@exemplo.com"],
    ["Rafael Moreira", "+5511991110006", null],
    ["Juliana Castro", "+5511991110007", "juliana@exemplo.com"],
    ["Bruno Tavares", "+5511991110008", null],
  ] as const;

  const contatos: { id: string; nome: string }[] = [];
  for (const [i, [nome, tel, email]] of pessoas.entries()) {
    const [c] = await sql<{ id: string; nome: string }[]>`
      INSERT INTO contato (org_id, nome, telefone_e164, email, ultima_interacao_em)
      VALUES (${org.id}, ${nome}, ${tel}, ${email}, ${emHoras(-i * 7)})
      RETURNING id, nome
    `;
    contatos.push(c);
  }

  // ------------------------------------------------------------- conversas
  const roteiros: {
    contato: number;
    modo: "ia" | "humano";
    intencao: string;
    naoLidas: number;
    resumo: string;
    arquivada?: boolean;
    turnos: [autor: "contato" | "ia" | "humano", texto: string][];
  }[] = [
    {
      contato: 0,
      modo: "ia",
      intencao: "agendamento",
      naoLidas: 2,
      resumo: "Quer remarcar a consulta de quinta para a semana que vem.",
      turnos: [
        ["contato", "Oi, bom dia! Consigo remarcar minha consulta de quinta?"],
        ["ia", "Bom dia, Maria! Consigo sim. Tenho terça às 10h ou quarta às 15h. Qual fica melhor?"],
        ["contato", "Terça às 10h fica ótimo"],
        ["ia", "Reservado: terça, 10h, com a Dra. Helena. Vou te lembrar um dia antes 🙂"],
        ["contato", "Perfeito, obrigada!"],
      ],
    },
    {
      contato: 1,
      modo: "humano",
      intencao: "cobranca",
      naoLidas: 1,
      resumo: "Pediu para parcelar a mensalidade de março em duas vezes.",
      turnos: [
        ["contato", "Recebi a cobrança mas esse mês apertou. Dá pra dividir?"],
        ["ia", "Consigo verificar com a equipe. Um instante, por favor."],
        ["humano", "Oi João, aqui é o Gustavo. Consigo dividir em 2x sem juros, tudo bem?"],
        ["contato", "Fechado, pode mandar"],
      ],
    },
    {
      contato: 2,
      modo: "ia",
      intencao: "duvida",
      naoLidas: 0,
      resumo: "Perguntou sobre convênio e valor da primeira consulta.",
      turnos: [
        ["contato", "Vocês atendem por convênio?"],
        ["ia", "Ainda não atendemos convênio. A primeira consulta é R$ 150 e o retorno R$ 90."],
        ["contato", "Entendi, obrigada"],
      ],
    },
    {
      contato: 3,
      modo: "ia",
      intencao: "agendamento",
      naoLidas: 3,
      resumo: "Quer horário no sábado de manhã.",
      turnos: [
        ["contato", "Boa tarde, tem horário no sábado?"],
        ["ia", "Temos! Sábado às 9h ou às 11h. Qual prefere?"],
        ["contato", "9h"],
        ["contato", "Consegue confirmar?"],
      ],
    },
    {
      contato: 4,
      modo: "ia",
      intencao: "suporte",
      naoLidas: 0,
      resumo: "Pediu o endereço e informação de estacionamento.",
      arquivada: true,
      turnos: [
        ["contato", "Qual o endereço mesmo?"],
        ["ia", "Rua das Acácias, 240 — sala 12. Estacionamento gratuito no prédio 🙂"],
      ],
    },
    {
      contato: 5,
      modo: "ia",
      intencao: "cobranca",
      naoLidas: 1,
      resumo: "Disse que já pagou, aguardando confirmação do comprovante.",
      turnos: [
        ["contato", "Já paguei ontem, pode conferir?"],
        ["ia", "Vou verificar e te confirmo em instantes, Rafael."],
      ],
    },
  ];

  const conversas: { id: string; contato: number }[] = [];
  for (const [i, r] of roteiros.entries()) {
    const ultima = emHoras(-(i * 3 + 1));
    const [conv] = await sql<{ id: string }[]>`
      INSERT INTO conversa (
        org_id, contato_id, canal_id, modo, intencao, resumo_ia, nao_lidas,
        atribuido_a, janela_expira_em, arquivada_em, ultima_atividade_em
      )
      VALUES (
        ${org.id}, ${contatos[r.contato].id}, ${canal.id},
        ${r.modo}::modo_conversa, ${r.intencao}::intencao, ${r.resumo}, ${r.naoLidas},
        ${r.modo === "humano" ? usuario.id : null},
        ${emHoras(20 - i)}, ${r.arquivada ? emHoras(-2) : null}, ${ultima}
      )
      RETURNING id
    `;
    conversas.push({ id: conv.id, contato: r.contato });

    for (const [t, [autor, texto]] of r.turnos.entries()) {
      const quando = new Date(
        ultima.getTime() - (r.turnos.length - t) * 4 * 60_000,
      );
      const entrada = autor === "contato";
      await sql`
        INSERT INTO mensagem (
          org_id, conversa_id, direcao, autor, autor_usuario_id, texto,
          status, provider_id, enviada_em, entregue_em, lida_em, criado_em
        )
        VALUES (
          ${org.id}, ${conv.id},
          ${entrada ? "entrada" : "saida"}::direcao_mensagem,
          ${autor}::autor_mensagem,
          ${autor === "humano" ? usuario.id : null},
          ${texto},
          ${entrada ? "lida" : "entregue"}::status_mensagem,
          ${`wamid.demo.${i}.${t}`},
          ${entrada ? null : quando}, ${entrada ? null : quando},
          ${entrada ? quando : null}, ${quando}
        )
      `;
    }
  }

  // -------------------------------------------------------------------- régua
  //
  // A régua padrão da casa: lembra três dias antes, cobra no dia e insiste uma
  // vez depois do atraso. Sem ela o painel de cobrança abre vazio e o worker
  // não tem o que materializar — que é justamente a peça que o protótipo
  // simulava com `setTimeout`.
  const [regua] = await sql<{ id: string }[]>`
    INSERT INTO regua (org_id, nome, descricao, padrao, pausar_ao_responder, pausar_ao_pagar)
    VALUES (
      ${org.id}, 'Cobrança amigável',
      'Lembrete antes, aviso no dia e uma insistência depois do vencimento.',
      true, true, true
    )
    RETURNING id
  `;

  const etapas = [
    {
      ordem: 1,
      offset: -3,
      hora: "09:00",
      msg: "Oi {{nome}}! Passando para lembrar: {{descricao}} de {{valor}} vence em {{vencimento}}. Qualquer dúvida é só responder por aqui.",
      pix: true,
    },
    {
      ordem: 2,
      offset: 0,
      hora: "09:00",
      msg: "Bom dia, {{nome}}! Hoje vence {{descricao}} ({{valor}}). Se já pagou, pode ignorar esta mensagem.",
      pix: true,
    },
    {
      ordem: 3,
      offset: 3,
      hora: "10:00",
      msg: "{{nome}}, {{descricao}} de {{valor}} venceu em {{vencimento}} e ainda consta em aberto. Consegue acertar hoje? Se preferir parcelar, me avisa.",
      pix: true,
    },
  ] as const;

  const etapasRegua: EtapaRegua[] = [];

  for (const e of etapas) {
    const [linha] = await sql<{ id: string }[]>`
      INSERT INTO regua_etapa (
        regua_id, ordem, referencia, offset_dias, hora, condicao, acao,
        mensagem, anexar_pix
      )
      VALUES (
        ${regua.id}, ${e.ordem}, 'vencimento', ${e.offset}, ${e.hora},
        'se_nao_pago', 'enviar_whatsapp', ${e.msg}, ${e.pix}
      )
      RETURNING id
    `;

    etapasRegua.push({
      id: linha.id,
      ordem: e.ordem,
      referencia: "vencimento",
      offsetDias: e.offset,
      hora: e.hora,
      condicao: "se_nao_pago",
      acao: "enviar_whatsapp",
      ativa: true,
    });
  }

  // ----------------------------------------------------------------- cobranças
  const cobrancas = [
    { c: 1, desc: "Mensalidade de março", valor: 30000, venc: -6, status: "vencido" },
    { c: 2, desc: "Consulta inicial", valor: 15000, venc: 3, status: "pendente" },
    { c: 0, desc: "Pacote 4 sessões", valor: 48000, venc: 9, status: "pendente" },
    { c: 5, desc: "Retorno", valor: 9000, venc: -2, status: "negociando" },
    { c: 3, desc: "Avaliação nutricional", valor: 12000, venc: -15, status: "pago" },
    { c: 4, desc: "Mensalidade de fevereiro", valor: 30000, venc: -40, status: "pago" },
    { c: 6, desc: "Consulta inicial", valor: 15000, venc: -1, status: "vencido" },
  ] as const;

  for (const co of cobrancas) {
    const pago = co.status === "pago";
    const [cobranca] = await sql<{ id: string; vencimento: string }[]>`
      INSERT INTO cobranca (
        org_id, contato_id, descricao, valor, vencimento, status, regua_id,
        tentativas, ultimo_envio_em, pago_em, valor_pago, origem, criado_por
      )
      VALUES (
        ${org.id}, ${contatos[co.c].id}, ${co.desc}, ${co.valor},
        ${dataISO(co.venc)}, ${co.status}::status_cobranca,
        ${pago ? null : regua.id},
        ${co.status === "vencido" ? 2 : 1}, ${emHoras(-30)},
        ${pago ? emHoras(co.venc * 24 + 6) : null}, ${pago ? co.valor : null},
        'manual', ${usuario.id}
      )
      RETURNING id, vencimento::text
    `;

    if (pago) continue;

    // A fila de disparos sai da MESMA função que o worker usa — semear a mão
    // produziria datas que a régua nunca geraria, e o bug apareceria só na tela.
    const plano = materializarDisparos(
      etapasRegua,
      { id: cobranca.id, vencimento: cobranca.vencimento, criadaEm: emHoras(-30) },
      {
        fuso: FUSO,
        horarioInicio: "08:00",
        horarioFim: "19:00",
        diasSemana: [1, 2, 3, 4, 5, 6],
      },
    );

    if (plano.disparos.length === 0) continue;

    const [execucao] = await sql<{ id: string }[]>`
      INSERT INTO regua_execucao (org_id, cobranca_id, regua_id)
      VALUES (${org.id}, ${cobranca.id}, ${regua.id})
      RETURNING id
    `;

    for (const d of plano.disparos) {
      await sql`
        INSERT INTO disparo (org_id, execucao_id, etapa_id, cobranca_id, executar_em)
        VALUES (
          ${org.id}, ${execucao.id}, ${d.etapaId}, ${cobranca.id}, ${d.executarEm}
        )
      `;
    }
  }

  // --------------------------------------------------------------- agendamentos
  const agenda = [
    { c: 0, s: 0, dia: 0, hora: 9, status: "confirmado" },
    { c: 2, s: 1, dia: 0, hora: 11, status: "pendente" },
    { c: 4, s: 2, dia: 0, hora: 15, status: "confirmado" },
    { c: 1, s: 0, dia: 1, hora: 10, status: "pendente" },
    { c: 3, s: 1, dia: 1, hora: 14, status: "confirmado" },
    { c: 5, s: 0, dia: 2, hora: 9, status: "pendente" },
    { c: 6, s: 2, dia: 3, hora: 16, status: "confirmado" },
    { c: 7, s: 1, dia: -2, hora: 10, status: "concluido" },
    { c: 2, s: 0, dia: -3, hora: 14, status: "faltou" },
    { c: 1, s: 1, dia: -5, hora: 11, status: "concluido" },
  ] as const;

  for (const a of agenda) {
    const servico = servicos[a.s];
    const inicio = hojeAs(a.dia, a.hora);
    const dur = servico.nome === "Retorno" ? 30 : servico.nome === "Consulta inicial" ? 60 : 45;
    const fim = new Date(inicio.getTime() + dur * 60_000);
    await sql`
      INSERT INTO agendamento (
        org_id, contato_id, servico_id, inicio, fim, status, origem, lembrete_em
      )
      VALUES (
        ${org.id}, ${contatos[a.c].id}, ${servico.id}, ${inicio}, ${fim},
        ${a.status}::status_agendamento, ${a.dia >= 0 ? "ia" : "manual"}::origem_registro,
        ${new Date(inicio.getTime() - 86_400_000)}
      )
      ON CONFLICT DO NOTHING
    `;
  }

  await sql`
    INSERT INTO bloqueio_agenda (org_id, motivo, inicio, fim)
    VALUES (${org.id}, 'Almoço', ${hojeAs(1, 12)}, ${hojeAs(1, 13)})
  `;

  // -------------------------------------------------------------------- sessão
  const token = randomBytes(32).toString("base64url");
  await sql`
    INSERT INTO sessao (usuario_id, token_hash, user_agent, expira_em)
    VALUES (${usuario.id}, ${hashToken(token)}, 'semear.ts', ${emHoras(24 * 30)})
  `;

  console.log("\nPronto.");
  console.log(`  organização : ${org.id} (${SLUG})`);
  console.log(`  login       : ${EMAIL} / ${SENHA}`);
  console.log(`  cookie      : autoflow_sessao=${token}`);
  console.log(
    `\n  curl -b "autoflow_sessao=${token}" http://localhost:3000/painel\n`,
  );
}

main()
  .then(() => sql.end())
  .catch(async (erro) => {
    console.error(erro);
    await sql.end();
    process.exit(1);
  });
