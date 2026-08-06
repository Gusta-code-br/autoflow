/**
 * Materialização da régua: transforma "3 dias depois do vencimento, às 09:00"
 * em instantes concretos gravados em `disparo`.
 *
 * Função pura de propósito. Toda a decisão fica testável sem banco, e o worker
 * só executa o que já foi decidido aqui.
 */

import {
  type DataLocal,
  type HoraLocal,
  dataLocalDe,
  dentroDoExpediente,
  instanteDaHoraLocal,
  somarDias,
} from "./tempo";

export type Referencia = "emissao" | "vencimento" | "pagamento";
export type Condicao = "sempre" | "se_nao_pago" | "se_pago" | "se_sem_resposta";
export type AcaoEtapa =
  | "enviar_whatsapp"
  | "notificar_voce"
  | "oferecer_parcelamento"
  | "marcar_perdido";

export interface EtapaRegua {
  id: string;
  ordem: number;
  referencia: Referencia;
  /** Negativo = antes da referência. */
  offsetDias: number;
  hora: HoraLocal;
  condicao: Condicao;
  acao: AcaoEtapa;
  ativa: boolean;
}

export interface CobrancaBase {
  id: string;
  vencimento: DataLocal;
  criadaEm: Date;
  pagoEm?: Date | null;
}

export interface ConfigDisparo {
  fuso: string;
  horarioInicio: HoraLocal;
  horarioFim: HoraLocal;
  /** 0 = domingo … 6 = sábado. */
  diasSemana: number[];
  respeitarExpediente?: boolean;
}

export type MotivoDescarte =
  | "etapa_inativa"
  | "sem_data_base"
  | "janela_perdida";

export type Ajuste = "expediente" | "atraso";

export interface DisparoPlanejado {
  etapaId: string;
  ordem: number;
  acao: AcaoEtapa;
  condicao: Condicao;
  /** Instante absoluto para gravar em `disparo.executar_em` (timestamptz). */
  executarEm: Date;
  /** Quando era para ter saído, antes dos ajustes. Serve para auditoria. */
  previstoPara: Date;
  ajustes: Ajuste[];
}

export interface EtapaDescartada {
  etapaId: string;
  motivo: MotivoDescarte;
}

export interface PlanoDisparos {
  disparos: DisparoPlanejado[];
  descartadas: EtapaDescartada[];
}

export interface OpcoesMaterializacao {
  agora?: Date;
  /**
   * Etapa cuja hora já passou há mais que isso não é enviada: ninguém quer
   * receber a cobrança "3 dias antes do vencimento" uma semana depois porque o
   * worker ficou fora do ar. Padrão: 12h.
   */
  toleranciaAtrasoHoras?: number;
}

/**
 * Data local que serve de âncora para a etapa. `pagamento` só existe depois de
 * pago — etapas de pós-pagamento (agradecimento, recibo) ficam sem data até lá,
 * e são materializadas de novo quando o pagamento entra.
 */
function dataBase(
  etapa: EtapaRegua,
  cobranca: CobrancaBase,
  fuso: string,
): DataLocal | null {
  switch (etapa.referencia) {
    case "vencimento":
      return cobranca.vencimento;
    case "emissao":
      return dataLocalDe(cobranca.criadaEm, fuso);
    case "pagamento":
      return cobranca.pagoEm ? dataLocalDe(cobranca.pagoEm, fuso) : null;
  }
}

export function materializarDisparos(
  etapas: EtapaRegua[],
  cobranca: CobrancaBase,
  cfg: ConfigDisparo,
  opcoes: OpcoesMaterializacao = {},
): PlanoDisparos {
  const agora = opcoes.agora ?? new Date();
  const toleranciaMs = (opcoes.toleranciaAtrasoHoras ?? 12) * 3_600_000;
  const respeitarExpediente = cfg.respeitarExpediente ?? true;

  const disparos: DisparoPlanejado[] = [];
  const descartadas: EtapaDescartada[] = [];

  for (const etapa of etapas) {
    if (!etapa.ativa) {
      descartadas.push({ etapaId: etapa.id, motivo: "etapa_inativa" });
      continue;
    }

    const base = dataBase(etapa, cobranca, cfg.fuso);
    if (!base) {
      descartadas.push({ etapaId: etapa.id, motivo: "sem_data_base" });
      continue;
    }

    const data = somarDias(base, etapa.offsetDias);
    const previstoPara = instanteDaHoraLocal(data, etapa.hora, cfg.fuso);

    const ajustes: Ajuste[] = [];
    let executarEm = previstoPara;

    if (executarEm.getTime() < agora.getTime()) {
      if (agora.getTime() - executarEm.getTime() > toleranciaMs) {
        descartadas.push({ etapaId: etapa.id, motivo: "janela_perdida" });
        continue;
      }
      // Atraso curto (worker parado, cobrança criada tarde): manda agora.
      executarEm = agora;
      ajustes.push("atraso");
    }

    if (respeitarExpediente) {
      const dentro = dentroDoExpediente(executarEm, cfg);
      if (dentro.getTime() !== executarEm.getTime()) {
        executarEm = dentro;
        ajustes.push("expediente");
      }
    }

    disparos.push({
      etapaId: etapa.id,
      ordem: etapa.ordem,
      acao: etapa.acao,
      condicao: etapa.condicao,
      executarEm,
      previstoPara,
      ajustes,
    });
  }

  disparos.sort(
    (a, b) => a.executarEm.getTime() - b.executarEm.getTime() || a.ordem - b.ordem,
  );

  return { disparos, descartadas };
}

export interface EstadoCobranca {
  pago: boolean;
  cancelada: boolean;
  /** Contato respondeu depois do último envio desta cobrança. */
  respondeu: boolean;
  /** Contato pediu para parar (LGPD / bloqueio de canal). */
  optOut: boolean;
}

export type Veredito =
  | { enviar: true }
  | { enviar: false; motivo: string };

/**
 * Segunda barreira: a condição é reavaliada no momento do envio, não na
 * materialização. Entre agendar e disparar o cliente pode ter pago, respondido
 * ou pedido para sair — e o disparo já está na fila.
 */
export function avaliarCondicao(
  condicao: Condicao,
  estado: EstadoCobranca,
): Veredito {
  if (estado.optOut) return { enviar: false, motivo: "contato_optout" };
  if (estado.cancelada) return { enviar: false, motivo: "cobranca_cancelada" };

  switch (condicao) {
    case "sempre":
      return { enviar: true };
    case "se_nao_pago":
      return estado.pago
        ? { enviar: false, motivo: "ja_pago" }
        : { enviar: true };
    case "se_pago":
      return estado.pago
        ? { enviar: true }
        : { enviar: false, motivo: "ainda_nao_pago" };
    case "se_sem_resposta":
      if (estado.pago) return { enviar: false, motivo: "ja_pago" };
      return estado.respondeu
        ? { enviar: false, motivo: "cliente_respondeu" }
        : { enviar: true };
  }
}

/** Resumo em português para a tela de pré-visualização da régua. */
export function descreverEtapa(etapa: EtapaRegua): string {
  const quando =
    etapa.offsetDias === 0
      ? "no dia"
      : etapa.offsetDias > 0
        ? `${etapa.offsetDias} ${etapa.offsetDias === 1 ? "dia" : "dias"} depois`
        : `${Math.abs(etapa.offsetDias)} ${
            etapa.offsetDias === -1 ? "dia" : "dias"
          } antes`;

  const ref: Record<Referencia, string> = {
    emissao: "da criação da cobrança",
    vencimento: "do vencimento",
    pagamento: "do pagamento",
  };

  const cond: Record<Condicao, string> = {
    sempre: "",
    se_nao_pago: ", se ainda não tiver pago",
    se_pago: ", se já tiver pago",
    se_sem_resposta: ", se o cliente não tiver respondido",
  };

  return `${quando} ${ref[etapa.referencia]}, às ${etapa.hora}${cond[etapa.condicao]}`;
}
