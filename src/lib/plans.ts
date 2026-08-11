import type { FeatureKey, Periodo, PeriodoId, PlanId, Plano } from "./types";

export const PRECO_CONEXAO_EXTRA = 49;

export const FEATURES: Record<
  FeatureKey,
  { nome: string; descricao: string; icone: string }
> = {
  atendimento: {
    nome: "Atendimento",
    descricao:
      "IA responde seus clientes no WhatsApp 24h, com o nome e o tom da sua atendente.",
    icone: "chat",
  },
  cobranca: {
    nome: "Cobrança",
    descricao:
      "Réguas automáticas de cobrança: lembrete antes, no dia e depois do vencimento.",
    icone: "cash",
  },
  agendamento: {
    nome: "Agendamento",
    descricao:
      "A IA agenda pelo WhatsApp, joga na sua agenda e te avisa no seu WhatsApp pessoal.",
    icone: "calendar",
  },
};

export const PLANOS: Plano[] = [
  {
    id: "essencial",
    nome: "Essencial",
    chamada: "Para quem só quer parar de perder mensagem.",
    precoMensal: 97,
    features: ["atendimento"],
    conexoesInclusas: 1,
    beneficios: [
      "IA de atendimento 24/7 no WhatsApp",
      "1 número de WhatsApp conectado",
      "Sem limite de mensagens — você usa sua própria chave OpenAI",
      "Painel de conversas e histórico",
      "Assumir a conversa quando quiser",
    ],
  },
  {
    id: "profissional",
    nome: "Profissional",
    chamada: "Atende e ainda corre atrás do dinheiro por você.",
    precoMensal: 197,
    features: ["atendimento", "cobranca"],
    conexoesInclusas: 1,
    destaque: true,
    beneficios: [
      "Tudo do Essencial",
      "Réguas de cobrança automáticas ilimitadas",
      "PIX automático dentro da mensagem",
      "Relatório de recuperação de inadimplência",
    ],
  },
  {
    id: "completo",
    nome: "Completo",
    chamada: "Atendimento, cobrança e agenda no automático.",
    precoMensal: 347,
    features: ["atendimento", "cobranca", "agendamento"],
    conexoesInclusas: 2,
    beneficios: [
      "Tudo do Profissional",
      "Agendamento pela IA direto no WhatsApp",
      "Aviso no seu WhatsApp pessoal a cada novo agendamento",
      "2 números de WhatsApp inclusos",
    ],
  },
];

export const PERIODOS: Periodo[] = [
  { id: "mensal", nome: "1 mês", meses: 1, desconto: 0 },
  {
    id: "semestral",
    nome: "6 meses",
    meses: 6,
    desconto: 0.15,
    selo: "-15%",
  },
  { id: "anual", nome: "1 ano", meses: 12, desconto: 0.25, selo: "-25%" },
];

export const SEGMENTOS = [
  "Clínica / Consultório",
  "Odontologia",
  "Estética e Beleza",
  "Academia / Personal",
  "Escritório de Advocacia",
  "Contabilidade",
  "Loja / Varejo",
  "Prestador de serviço",
  "Escola / Curso",
  "Imobiliária",
  "Outro",
];

export const TONS = [
  {
    id: "amigavel",
    nome: "Amigável",
    exemplo: "Oi, Marina! Tudo bem? 😊 Posso te ajudar com alguma coisa?",
  },
  {
    id: "profissional",
    nome: "Profissional",
    exemplo: "Olá, Marina. Como posso ajudá-la hoje?",
  },
  {
    id: "direto",
    nome: "Direto",
    exemplo: "Oi Marina, me diz o que você precisa que eu resolvo.",
  },
];

export function getPlano(id: PlanId): Plano {
  return PLANOS.find((p) => p.id === id) ?? PLANOS[0];
}

export function getPeriodo(id: PeriodoId): Periodo {
  return PERIODOS.find((p) => p.id === id) ?? PERIODOS[0];
}

/** Preço mensal equivalente já com o desconto do período aplicado. */
export function precoMensalCom(planoId: PlanId, periodoId: PeriodoId): number {
  const plano = getPlano(planoId);
  const periodo = getPeriodo(periodoId);
  return Math.round(plano.precoMensal * (1 - periodo.desconto));
}

/** Valor total cobrado de uma vez pelo período inteiro. */
export function precoTotalCom(planoId: PlanId, periodoId: PeriodoId): number {
  return precoMensalCom(planoId, periodoId) * getPeriodo(periodoId).meses;
}

export function economiaCom(planoId: PlanId, periodoId: PeriodoId): number {
  const plano = getPlano(planoId);
  const periodo = getPeriodo(periodoId);
  return plano.precoMensal * periodo.meses - precoTotalCom(planoId, periodoId);
}

export function planoTem(planoId: PlanId, feature: FeatureKey): boolean {
  return getPlano(planoId).features.includes(feature);
}

/** Menor plano que inclui a feature — usado nas telas de upgrade. */
export function planoMinimoPara(feature: FeatureKey): Plano {
  return PLANOS.find((p) => p.features.includes(feature)) ?? PLANOS[2];
}
