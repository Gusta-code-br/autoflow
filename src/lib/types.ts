// Domínio do AutoFlow — protótipo navegável (dados mockados)

export type FeatureKey = "atendimento" | "cobranca" | "agendamento";
export type PlanId = "essencial" | "profissional" | "completo";
export type PeriodoId = "mensal" | "semestral" | "anual";

export interface Plano {
  id: PlanId;
  nome: string;
  chamada: string;
  precoMensal: number;
  features: FeatureKey[];
  conexoesInclusas: number;
  destaque?: boolean;
  beneficios: string[];
}

export interface Periodo {
  id: PeriodoId;
  nome: string;
  meses: number;
  desconto: number; // 0..1
  selo?: string;
}

export interface Conta {
  id: string;
  nomeEmpresa: string;
  segmento: string;
  nomeAtendente: string;
  tom: string;
  objetivos: FeatureKey[];
  email: string;
  whatsappPessoal: string;
  horarioAtendimento: string;
  planoId: PlanId;
  periodo: PeriodoId;
  assinadoEm: string;
  expiraEm: string;
  creditosUsados: number;
  creditosExtras: number;
  conexoesExtras: number;
  onboardingCompleto: boolean;
  notificarNovoAgendamento: boolean;
  notificarPagamento: boolean;
  notificarSemResposta: boolean;
}

export type StatusCobranca =
  | "pendente"
  | "pago"
  | "vencido"
  | "negociando"
  | "cancelado";

export interface Cobranca {
  id: string;
  clienteNome: string;
  clienteTelefone: string;
  descricao: string;
  valor: number;
  vencimento: string;
  status: StatusCobranca;
  reguaId: string | null;
  tentativas: number;
  ultimoEnvio: string | null;
  pagoEm: string | null;
  tags: string[];
}

export type Referencia = "emissao" | "vencimento" | "pagamento";
export type Condicao =
  | "sempre"
  | "se_nao_pago"
  | "se_pago"
  | "se_sem_resposta";
export type Acao =
  | "enviar_whatsapp"
  | "notificar_voce"
  | "oferecer_parcelamento"
  | "marcar_perdido";

export interface EtapaRegua {
  id: string;
  referencia: Referencia;
  offsetDias: number; // negativo = antes, positivo = depois
  hora: string; // "09:00"
  condicao: Condicao;
  acao: Acao;
  mensagem: string;
  anexarPix: boolean;
  ativa: boolean;
}

export interface Regua {
  id: string;
  nome: string;
  descricao: string;
  ativa: boolean;
  aplicarA: "todas" | "tag";
  tag: string | null;
  pausarAoResponder: boolean;
  pausarAoPagar: boolean;
  etapas: EtapaRegua[];
  criadaEm: string;
  stats: { enviadas: number; respondidas: number; recuperado: number };
}

export type AutorMensagem = "cliente" | "ia" | "humano" | "sistema";

export interface Mensagem {
  id: string;
  autor: AutorMensagem;
  texto: string;
  hora: string;
}

export type Intencao = "cobranca" | "agendamento" | "duvida" | "suporte";

export interface Conversa {
  id: string;
  contatoNome: string;
  contatoTelefone: string;
  intencao: Intencao;
  tags: string[];
  naoLidas: number;
  ultimaAtividade: string;
  modo: "ia" | "humano";
  resumoIA: string;
  mensagens: Mensagem[];
}

export type StatusAgendamento =
  | "confirmado"
  | "pendente"
  | "cancelado"
  | "concluido";

export interface Agendamento {
  id: string;
  clienteNome: string;
  clienteTelefone: string;
  servico: string;
  inicio: string;
  duracaoMin: number;
  status: StatusAgendamento;
  origem: "ia" | "manual";
  observacao: string;
}

export interface Conexao {
  id: string;
  nome: string;
  numero: string;
  status: "conectado" | "desconectado" | "conectando";
  principal: boolean;
  mensagensMes: number;
  ultimaSync: string;
}

export interface Transacao {
  id: string;
  tipo: "assinatura" | "creditos" | "conexao";
  descricao: string;
  valor: number;
  data: string;
  status: "pago" | "pendente";
  metodo: "pix" | "cartao";
}

export interface UsoDiario {
  data: string;
  atendimento: number;
  cobranca: number;
  agendamento: number;
}
