import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  dataLocalDe,
  dentroDoExpediente,
  diasEntre,
  horaLocalDe,
  instanteDaHoraLocal,
  offsetMinutos,
  somarDias,
} from "./tempo";
import { formatarTelefoneBR, normalizarE164 } from "./telefone";
import { formatarBRL, parcelar, parseValorBR, reaisParaCentavos } from "./dinheiro";
import {
  type EtapaRegua,
  avaliarCondicao,
  descreverEtapa,
  materializarDisparos,
} from "./regua";
import {
  type ContextoMensagem,
  VariavelVaziaError,
  paraTemplateMeta,
  parametrosMeta,
  preencherVariaveis,
  validarTemplate,
} from "./variaveis";

const SP = "America/Sao_Paulo";

describe("tempo", () => {
  it("converte hora de parede para UTC no fuso certo", () => {
    // 09:00 em São Paulo (UTC-3) = 12:00Z. Este é o bug que o protótipo tinha.
    const t = instanteDaHoraLocal("2026-08-10", "09:00", SP);
    assert.equal(t.toISOString(), "2026-08-10T12:00:00.000Z");
  });

  it("ida e volta é estável", () => {
    const t = instanteDaHoraLocal("2026-12-25", "18:30", SP);
    assert.equal(dataLocalDe(t, SP), "2026-12-25");
    assert.equal(horaLocalDe(t, SP), "18:30");
  });

  it("respeita horário de verão onde ele existe", () => {
    const NY = "America/New_York";
    // Inverno: UTC-5. Verão: UTC-4.
    assert.equal(offsetMinutos(NY, new Date("2026-01-15T12:00:00Z")), -300);
    assert.equal(offsetMinutos(NY, new Date("2026-07-15T12:00:00Z")), -240);

    assert.equal(
      instanteDaHoraLocal("2026-07-15", "09:00", NY).toISOString(),
      "2026-07-15T13:00:00.000Z",
    );
    assert.equal(
      instanteDaHoraLocal("2026-01-15", "09:00", NY).toISOString(),
      "2026-01-15T14:00:00.000Z",
    );
  });

  it("não perde o dia na virada da meia-noite", () => {
    // 23:00 em SP no dia 10 é 02:00Z do dia 11 — a data local segue sendo 10.
    const t = instanteDaHoraLocal("2026-08-10", "23:00", SP);
    assert.equal(t.toISOString(), "2026-08-11T02:00:00.000Z");
    assert.equal(dataLocalDe(t, SP), "2026-08-10");
  });

  it("soma dias atravessando mês e ano bissexto", () => {
    assert.equal(somarDias("2026-01-31", 1), "2026-02-01");
    assert.equal(somarDias("2028-02-28", 1), "2028-02-29");
    assert.equal(somarDias("2026-03-01", -1), "2026-02-28");
    assert.equal(diasEntre("2026-08-01", "2026-08-31"), 30);
  });

  const expediente = {
    fuso: SP,
    horarioInicio: "09:00",
    horarioFim: "18:00",
    diasSemana: [1, 2, 3, 4, 5],
  };

  it("empurra madrugada para a abertura", () => {
    const t = instanteDaHoraLocal("2026-08-10", "03:00", SP); // segunda
    const r = dentroDoExpediente(t, expediente);
    assert.equal(horaLocalDe(r, SP), "09:00");
    assert.equal(dataLocalDe(r, SP), "2026-08-10");
  });

  it("empurra sexta à noite para segunda de manhã", () => {
    const sexta = instanteDaHoraLocal("2026-08-07", "22:00", SP);
    const r = dentroDoExpediente(sexta, expediente);
    assert.equal(dataLocalDe(r, SP), "2026-08-10");
    assert.equal(horaLocalDe(r, SP), "09:00");
  });

  it("não mexe no que já está dentro do expediente", () => {
    const t = instanteDaHoraLocal("2026-08-10", "14:00", SP);
    assert.equal(dentroDoExpediente(t, expediente).getTime(), t.getTime());
  });
});

describe("telefone", () => {
  it("normaliza as formas que chegam do formulário e do webhook", () => {
    const esperado = "+5511991234501";
    for (const entrada of [
      "(11) 99123-4501",
      "11991234501",
      "5511991234501",
      "+55 11 99123-4501",
      "005511991234501",
    ]) {
      assert.equal(normalizarE164(entrada), esperado, entrada);
    }
  });

  it("repõe o nono dígito de celular antigo", () => {
    // Mesmo cliente, cadastro velho: não pode virar contato duplicado.
    assert.equal(normalizarE164("1191234501"), "+5511991234501");
    assert.equal(normalizarE164("551191234501"), "+5511991234501");
  });

  it("preserva fixo de 8 dígitos", () => {
    assert.equal(normalizarE164("1132145678"), "+551132145678");
  });

  it("recusa lixo em vez de gravar", () => {
    for (const ruim of ["", "123", "abc", "119912345", "0000000000", null]) {
      assert.equal(normalizarE164(ruim as string), null, String(ruim));
    }
  });

  it("assume celular antigo quando o número é ambíguo", () => {
    // '1199123450' pode ser um 9-dígitos truncado por erro de digitação OU um
    // celular antigo de 8 dígitos. Não há como distinguir: escolhemos repor o
    // 9, que é o caso comum em base importada. Registrado aqui para quem mexer
    // depois saber que é decisão, não descuido.
    assert.equal(normalizarE164("1199123450"), "+5511999123450");
  });

  it("recusa DDD inexistente", () => {
    assert.equal(normalizarE164("2099123-4501"), null);
  });

  it("aceita número de outro país quando vem com '+' explícito", () => {
    // Sem o '+' esses mesmos dígitos seriam ambíguos com um número
    // brasileiro (11 dígitos, começa com algo que parece DDD válido).
    assert.equal(normalizarE164("+1 202 555 0143"), "+12025550143");
    assert.equal(normalizarE164("+351 912 345 678"), "+351912345678");
    assert.equal(normalizarE164("+44 20 7946 0958"), "+442079460958");
  });

  it("sem '+', número curto de outro país cai na regra de DDD e é recusado", () => {
    // Isso é esperado, não um bug: sem o '+' não há como saber que não é
    // um número nacional. A UI deve orientar o uso do '+' + código do país.
    assert.equal(normalizarE164("2025550143"), null);
  });

  it("formata para exibição", () => {
    assert.equal(formatarTelefoneBR("+5511991234501"), "(11) 99123-4501");
    assert.equal(formatarTelefoneBR("+551132145678"), "(11) 3214-5678");
  });
});

describe("dinheiro", () => {
  it("arredonda sem erro de float", () => {
    assert.equal(reaisParaCentavos(19.99), 1999);
    assert.equal(reaisParaCentavos(0.1 + 0.2), 30);
    assert.equal(reaisParaCentavos(1234.565), 123457);
  });

  it("entende o que o usuário digita", () => {
    assert.equal(parseValorBR("1.234,56"), 123456);
    assert.equal(parseValorBR("R$ 1.234,56"), 123456);
    assert.equal(parseValorBR("1234.56"), 123456);
    assert.equal(parseValorBR("1,234.56"), 123456);
    assert.equal(parseValorBR("99"), 9900);
    assert.equal(parseValorBR("1.500"), 150000);
    assert.equal(parseValorBR("0,50"), 50);
  });

  it("recusa valor inválido ou absurdo", () => {
    for (const ruim of ["", "abc", "-10", "R$", "1e9999"]) {
      assert.equal(parseValorBR(ruim), null, ruim);
    }
  });

  it("formata em BRL", () => {
    assert.equal(formatarBRL(123456).replace(/ /g, " "), "R$ 1.234,56");
  });

  it("parcela sem perder centavo", () => {
    const p = parcelar(10000, 3);
    assert.deepEqual(p, [3334, 3333, 3333]);
    assert.equal(p.reduce((a, b) => a + b, 0), 10000);
  });
});

describe("régua", () => {
  const cfg = {
    fuso: SP,
    horarioInicio: "09:00",
    horarioFim: "18:00",
    diasSemana: [1, 2, 3, 4, 5],
  };

  const etapa = (over: Partial<EtapaRegua> = {}): EtapaRegua => ({
    id: "e1",
    ordem: 1,
    referencia: "vencimento",
    offsetDias: 0,
    hora: "09:00",
    condicao: "se_nao_pago",
    acao: "enviar_whatsapp",
    ativa: true,
    ...over,
  });

  const cobranca = {
    id: "c1",
    vencimento: "2026-08-20",
    criadaEm: new Date("2026-08-01T13:00:00Z"),
  };

  const agora = new Date("2026-08-01T13:00:00Z"); // 10:00 em SP, sábado

  it("agenda antes e depois do vencimento na hora local", () => {
    const plano = materializarDisparos(
      [
        etapa({ id: "antes", ordem: 1, offsetDias: -3 }),
        etapa({ id: "dia", ordem: 2, offsetDias: 0 }),
        etapa({ id: "depois", ordem: 3, offsetDias: 5 }),
      ],
      cobranca,
      cfg,
      { agora },
    );

    assert.equal(plano.disparos.length, 3);
    assert.equal(
      plano.disparos[0].previstoPara.toISOString(),
      "2026-08-17T12:00:00.000Z", // 17/08 09:00 SP
    );
    // Ordenado por execução
    assert.deepEqual(
      plano.disparos.map((d) => d.etapaId),
      ["antes", "dia", "depois"],
    );
  });

  it("descarta etapa inativa e etapa sem data base", () => {
    const plano = materializarDisparos(
      [
        etapa({ id: "off", ativa: false }),
        etapa({ id: "pos", referencia: "pagamento", offsetDias: 1 }),
      ],
      cobranca,
      cfg,
      { agora },
    );

    assert.equal(plano.disparos.length, 0);
    assert.deepEqual(plano.descartadas, [
      { etapaId: "off", motivo: "etapa_inativa" },
      { etapaId: "pos", motivo: "sem_data_base" },
    ]);
  });

  it("materializa pós-pagamento quando o pagamento entra", () => {
    const plano = materializarDisparos(
      [etapa({ id: "obrigado", referencia: "pagamento", offsetDias: 0, condicao: "se_pago" })],
      { ...cobranca, pagoEm: new Date("2026-08-18T14:00:00Z") },
      cfg,
      { agora: new Date("2026-08-18T14:00:00Z") },
    );
    assert.equal(plano.disparos.length, 1);
    assert.equal(dataLocalDe(plano.disparos[0].executarEm, SP), "2026-08-18");
  });

  it("não dispara etapa cuja janela passou faz tempo", () => {
    // Cobrança cadastrada hoje com vencimento de duas semanas atrás: as etapas
    // antigas não podem sair todas de uma vez na cara do cliente.
    const plano = materializarDisparos(
      [etapa({ id: "velha", offsetDias: 0 })],
      { ...cobranca, vencimento: "2026-07-15" },
      cfg,
      { agora },
    );
    assert.equal(plano.disparos.length, 0);
    assert.deepEqual(plano.descartadas, [
      { etapaId: "velha", motivo: "janela_perdida" },
    ]);
  });

  it("recupera atraso curto e respeita o expediente", () => {
    // Hora prevista: hoje 09:00 SP; agora são 10:00 SP de um sábado.
    const plano = materializarDisparos(
      [etapa({ id: "hoje", referencia: "emissao", offsetDias: 0 })],
      cobranca,
      cfg,
      { agora },
    );

    const d = plano.disparos[0];
    assert.deepEqual(d.ajustes, ["atraso", "expediente"]);
    // Sábado → segunda 09:00 SP
    assert.equal(dataLocalDe(d.executarEm, SP), "2026-08-03");
    assert.equal(horaLocalDe(d.executarEm, SP), "09:00");
  });

  it("condição é reavaliada no envio", () => {
    const base = { pago: false, cancelada: false, respondeu: false, optOut: false };

    assert.deepEqual(avaliarCondicao("se_nao_pago", base), { enviar: true });
    assert.deepEqual(avaliarCondicao("se_nao_pago", { ...base, pago: true }), {
      enviar: false,
      motivo: "ja_pago",
    });
    assert.deepEqual(
      avaliarCondicao("se_sem_resposta", { ...base, respondeu: true }),
      { enviar: false, motivo: "cliente_respondeu" },
    );
    // opt-out vence qualquer condição, inclusive 'sempre'
    assert.deepEqual(avaliarCondicao("sempre", { ...base, optOut: true }), {
      enviar: false,
      motivo: "contato_optout",
    });
  });

  it("descreve a etapa em português para a tela", () => {
    assert.equal(
      descreverEtapa(etapa({ offsetDias: -1 })),
      "1 dia antes do vencimento, às 09:00, se ainda não tiver pago",
    );
    assert.equal(
      descreverEtapa(etapa({ offsetDias: 3, condicao: "sempre", hora: "14:30" })),
      "3 dias depois do vencimento, às 14:30",
    );
  });
});

describe("variáveis", () => {
  const ctx: ContextoMensagem = {
    nomeCompleto: "Maria Alves Souza",
    valorCentavos: 25000,
    vencimento: "2026-08-20",
    descricao: "Sessão de fisioterapia",
    diasAtraso: 0,
    empresa: "Clínica Vitalis",
    atendente: "Marina",
    linkPagamento: "https://pag.link/abc",
  };

  it("preenche com primeiro nome e valor formatado", () => {
    const out = preencherVariaveis(
      "Oi {{nome}}, sua cobrança de {{valor}} vence em {{vencimento}}.",
      ctx,
    );
    assert.equal(
      out.replace(/ /g, " "),
      "Oi Maria, sua cobrança de R$ 250,00 vence em 20/08/2026.",
    );
  });

  it("derruba o envio se variável obrigatória está vazia", () => {
    assert.throws(
      () => preencherVariaveis("Oi {{nome}}", { ...ctx, nomeCompleto: "  " }),
      VariavelVaziaError,
    );
  });

  it("deixa passar opcional vazia e limpa o espaço sobrando", () => {
    const out = preencherVariaveis("Oi {{nome}}. {{descricao}} Obrigado!", {
      ...ctx,
      descricao: null,
    });
    assert.equal(out, "Oi Maria. Obrigado!");
  });

  it("acusa variável que não existe", () => {
    const r = validarTemplate("Oi {{nome}}, seu {{cpf}} e {{saldo}}");
    assert.equal(r.ok, false);
    assert.deepEqual(r.desconhecidas, ["cpf", "saldo"]);
  });

  it("converte para template posicional da Meta", () => {
    const t = paraTemplateMeta("Oi {{nome}}, {{valor}} vence {{vencimento}}. Até, {{nome}}!");
    assert.equal(t.corpo, "Oi {{1}}, {{2}} vence {{3}}. Até, {{1}}!");
    assert.deepEqual(t.ordem, ["nome", "valor", "vencimento"]);

    const p = parametrosMeta(t.ordem, ctx).map((v) => v.replace(/ /g, " "));
    assert.deepEqual(p, ["Maria", "R$ 250,00", "20/08/2026"]);
  });
});
