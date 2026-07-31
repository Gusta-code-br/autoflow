import { brl, dataCurta, diasAte, prazoRelativo } from "./format";
import type {
  Acao,
  Cobranca,
  Condicao,
  Conta,
  EtapaRegua,
  Referencia,
  Regua,
} from "./types";

export const ROTULO_REFERENCIA: Record<Referencia, string> = {
  emissao: "da emissão",
  vencimento: "do vencimento",
  pagamento: "do pagamento",
};

export const ROTULO_CONDICAO: Record<Condicao, string> = {
  sempre: "Sempre",
  se_nao_pago: "Só se ainda não pagou",
  se_pago: "Só se já pagou",
  se_sem_resposta: "Só se não respondeu",
};

export const ROTULO_ACAO: Record<Acao, string> = {
  enviar_whatsapp: "Enviar mensagem no WhatsApp",
  notificar_voce: "Me avisar no meu WhatsApp",
  oferecer_parcelamento: "Oferecer parcelamento",
  marcar_perdido: "Marcar como perdido",
};

export const ICONE_ACAO: Record<Acao, "whatsapp" | "bell" | "cash" | "x"> = {
  enviar_whatsapp: "whatsapp",
  notificar_voce: "bell",
  oferecer_parcelamento: "cash",
  marcar_perdido: "x",
};

/** "3 dias antes do vencimento, às 09:00" */
export function rotuloQuando(e: EtapaRegua): string {
  const ref = ROTULO_REFERENCIA[e.referencia];
  if (e.offsetDias === 0) return `No dia ${ref.replace("do ", "do ")}, às ${e.hora}`;
  const n = Math.abs(e.offsetDias);
  const lado = e.offsetDias < 0 ? "antes" : "depois";
  return `${n} ${n === 1 ? "dia" : "dias"} ${lado} ${ref}, às ${e.hora}`;
}

/** Rótulo curto para a linha do tempo: "D-3", "D0", "D+7" */
export function rotuloCurto(e: EtapaRegua): string {
  if (e.offsetDias === 0) return "D0";
  return e.offsetDias < 0 ? `D${e.offsetDias}` : `D+${e.offsetDias}`;
}

export interface ContextoMensagem {
  nome: string;
  valor: number;
  vencimento: string;
  descricao: string;
  empresa: string;
  atendente: string;
}

/** Substitui as variáveis {{...}} pelo conteúdo real (ou de exemplo). */
export function preencherVariaveis(
  texto: string,
  ctx: ContextoMensagem,
): string {
  const dias = Math.abs(diasAte(ctx.vencimento));
  const mapa: Record<string, string> = {
    nome: ctx.nome.split(" ")[0] ?? ctx.nome,
    valor: brl(ctx.valor, true),
    vencimento: dataCurta(ctx.vencimento),
    dias: String(dias),
    prazo: prazoRelativo(ctx.vencimento),
    descricao: ctx.descricao.toLowerCase(),
    empresa: ctx.empresa,
    atendente: ctx.atendente,
    link_pix: "00020126580014BR.GOV.BCB.PIX…",
  };
  return texto.replace(/\{\{(\w+)\}\}/g, (bruto, chave: string) =>
    chave in mapa ? mapa[chave] : bruto,
  );
}

export function contextoExemplo(conta: Conta): ContextoMensagem {
  const venc = new Date();
  venc.setDate(venc.getDate() + 3);
  return {
    nome: "Marina Alves",
    valor: 280,
    vencimento: venc.toISOString(),
    descricao: "Sessão de limpeza de pele",
    empresa: conta.nomeEmpresa || "Sua empresa",
    atendente: conta.nomeAtendente || "Sofia",
  };
}

export function contextoDaCobranca(
  cob: Cobranca,
  conta: Conta,
): ContextoMensagem {
  return {
    nome: cob.clienteNome,
    valor: cob.valor,
    vencimento: cob.vencimento,
    descricao: cob.descricao,
    empresa: conta.nomeEmpresa || "Sua empresa",
    atendente: conta.nomeAtendente || "Sofia",
  };
}

/** Data/hora em que a etapa dispararia para uma cobrança específica. */
export function dataDisparo(cob: Cobranca, etapa: EtapaRegua): Date {
  const base =
    etapa.referencia === "pagamento" && cob.pagoEm
      ? new Date(cob.pagoEm)
      : new Date(cob.vencimento);
  const [h, m] = etapa.hora.split(":").map(Number);
  const dt = new Date(base);
  dt.setDate(dt.getDate() + etapa.offsetDias);
  dt.setHours(h ?? 9, m ?? 0, 0, 0);
  return dt;
}

function condicaoValeAgora(cond: Condicao, cob: Cobranca): boolean {
  switch (cond) {
    case "se_nao_pago":
      return cob.status !== "pago" && cob.status !== "cancelado";
    case "se_pago":
      return cob.status === "pago";
    case "se_sem_resposta":
      return cob.status !== "pago" && cob.status !== "negociando";
    default:
      return cob.status !== "cancelado";
  }
}

export interface Disparo {
  cobranca: Cobranca;
  regua: Regua;
  etapa: EtapaRegua;
  quando: Date;
}

/** Próximos envios que a automação faria, ordenados por data. */
export function proximosDisparos(
  cobrancas: Cobranca[],
  reguas: Regua[],
  limite = 8,
): Disparo[] {
  const agora = Date.now();
  const saida: Disparo[] = [];

  for (const cob of cobrancas) {
    if (cob.status === "cancelado") continue;
    const regua = reguas.find((r) => r.id === cob.reguaId);
    if (!regua || !regua.ativa) continue;
    if (regua.pausarAoPagar && cob.status === "pago") continue;

    for (const etapa of regua.etapas) {
      if (!etapa.ativa) continue;
      if (!condicaoValeAgora(etapa.condicao, cob)) continue;
      const quando = dataDisparo(cob, etapa);
      if (quando.getTime() <= agora) continue;
      saida.push({ cobranca: cob, regua, etapa, quando });
    }
  }

  return saida
    .sort((a, b) => a.quando.getTime() - b.quando.getTime())
    .slice(0, limite);
}

/** Simulação completa da régua sobre uma cobrança (passado e futuro). */
export function simularRegua(
  regua: Regua,
  cob: Cobranca,
): { etapa: EtapaRegua; quando: Date; passado: boolean }[] {
  return regua.etapas
    .map((etapa) => {
      const quando = dataDisparo(cob, etapa);
      return { etapa, quando, passado: quando.getTime() < Date.now() };
    })
    .sort((a, b) => a.quando.getTime() - b.quando.getTime());
}

let contador = 0;
export function novoId(prefixo: string): string {
  contador += 1;
  return `${prefixo}_${Date.now().toString(36)}${contador}`;
}

export function novaEtapa(offsetDias = 1): EtapaRegua {
  return {
    id: novoId("et"),
    referencia: "vencimento",
    offsetDias,
    hora: "09:00",
    condicao: "se_nao_pago",
    acao: "enviar_whatsapp",
    mensagem:
      "Oi {{nome}}! Aqui é a {{atendente}} da {{empresa}}.\nSua {{descricao}} de {{valor}} venceu {{prazo}}. Consigo te ajudar a resolver?",
    anexarPix: true,
    ativa: true,
  };
}

export function novaRegua(): Regua {
  return {
    id: novoId("reg"),
    nome: "Nova régua de cobrança",
    descricao: "",
    ativa: false,
    aplicarA: "todas",
    tag: null,
    pausarAoResponder: false,
    pausarAoPagar: true,
    etapas: [
      {
        ...novaEtapa(-3),
        condicao: "se_nao_pago",
        anexarPix: false,
        mensagem:
          "Oi {{nome}}! Passando pra lembrar que sua {{descricao}} de {{valor}} vence em {{dias}} dias ({{vencimento}}) 😊",
      },
      {
        ...novaEtapa(0),
        mensagem:
          "Bom dia, {{nome}}! Hoje é o vencimento da sua {{descricao}} de {{valor}}. Segue o PIX 👇",
      },
      {
        ...novaEtapa(3),
        mensagem:
          "Oi {{nome}}, tudo bem? A {{descricao}} de {{valor}} venceu {{prazo}} e ainda consta em aberto. Aconteceu alguma coisa?",
      },
    ],
    criadaEm: new Date().toISOString(),
    stats: { enviadas: 0, respondidas: 0, recuperado: 0 },
  };
}

/** Modelos prontos para quem não quer montar do zero. */
export const MODELOS_REGUA: {
  id: string;
  nome: string;
  descricao: string;
  construir: () => Regua;
}[] = [
  {
    id: "mod_suave",
    nome: "Lembrete gentil",
    descricao: "Dois toques leves: antes e depois do vencimento.",
    construir: () => {
      const r = novaRegua();
      r.nome = "Lembrete gentil";
      r.descricao = "Dois toques leves, sem pressão.";
      r.etapas = [
        {
          ...novaEtapa(-2),
          anexarPix: false,
          mensagem:
            "Oi {{nome}}! Só um lembrete carinhoso: sua {{descricao}} de {{valor}} vence em {{dias}} dias 😊",
        },
        {
          ...novaEtapa(2),
          mensagem:
            "Oi {{nome}}! A {{descricao}} de {{valor}} venceu {{prazo}}. Se já pagou, pode ignorar 💜 Se não, o PIX está aqui:",
        },
      ];
      return r;
    },
  },
  {
    id: "mod_firme",
    nome: "Recuperação firme",
    descricao: "Cinco toques crescentes até virar aviso pra você.",
    construir: () => {
      const r = novaRegua();
      r.nome = "Recuperação firme";
      r.descricao = "Insiste até resolver ou te avisar.";
      r.etapas = [
        { ...novaEtapa(-3), anexarPix: false },
        { ...novaEtapa(0) },
        { ...novaEtapa(3) },
        {
          ...novaEtapa(7),
          acao: "oferecer_parcelamento",
          anexarPix: false,
          mensagem:
            "{{nome}}, consigo dividir esses {{valor}} pra facilitar. Quer em 2x ou 3x?",
        },
        {
          ...novaEtapa(14),
          acao: "notificar_voce",
          anexarPix: false,
          mensagem:
            "⚠️ {{nome}} está há 14 dias em atraso ({{valor}}) e não respondeu.",
        },
      ];
      return r;
    },
  },
  {
    id: "mod_recorrente",
    nome: "Mensalidade recorrente",
    descricao: "Ideal pra plano mensal: avisa, cobra e agradece.",
    construir: () => {
      const r = novaRegua();
      r.nome = "Mensalidade recorrente";
      r.descricao = "Ciclo completo de uma mensalidade.";
      r.etapas = [
        { ...novaEtapa(-5), anexarPix: false },
        { ...novaEtapa(0) },
        { ...novaEtapa(2) },
        {
          ...novaEtapa(0),
          referencia: "pagamento",
          condicao: "se_pago",
          acao: "enviar_whatsapp",
          anexarPix: false,
          hora: "12:00",
          mensagem:
            "Recebemos seu pagamento de {{valor}}, {{nome}}! Obrigada 💜",
        },
      ];
      return r;
    },
  },
];
