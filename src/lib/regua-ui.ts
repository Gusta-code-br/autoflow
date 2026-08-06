/**
 * Rótulos e ícones das etapas de régua.
 *
 * Fica em `src/lib` porque o editor é client: os tipos vêm de
 * `@/server/dominio/regua`, que é puro (só `Intl` e aritmética de data) e não
 * arrasta banco nenhum para o bundle. O que NÃO pode acontecer é a tela ter uma
 * lista de ações própria — se o domínio ganhar uma ação nova, o `Record` abaixo
 * para de compilar até alguém escrever o nome dela em português.
 */

import type {
  AcaoEtapa,
  Condicao,
  EtapaRegua,
  Referencia,
} from "@/server/dominio/regua";

export const ROTULO_REFERENCIA: Record<Referencia, string> = {
  emissao: "criação da cobrança",
  vencimento: "vencimento",
  pagamento: "pagamento",
};

export const ROTULO_CONDICAO: Record<Condicao, string> = {
  sempre: "Sempre",
  se_nao_pago: "Se não pagou",
  se_pago: "Se pagou",
  se_sem_resposta: "Se não respondeu",
};

export const ROTULO_ACAO: Record<AcaoEtapa, string> = {
  enviar_whatsapp: "Enviar WhatsApp",
  notificar_voce: "Avisar você",
  oferecer_parcelamento: "Oferecer parcelamento",
  marcar_perdido: "Marcar como perdida",
};

export const ICONE_ACAO: Record<AcaoEtapa, "whatsapp" | "bell" | "cash" | "x"> = {
  enviar_whatsapp: "whatsapp",
  notificar_voce: "bell",
  oferecer_parcelamento: "cash",
  marcar_perdido: "x",
};

/** "3 dias depois do vencimento, às 09:00" — a frase que a linha do tempo mostra. */
export function rotuloQuando(e: Pick<EtapaRegua, "referencia" | "offsetDias" | "hora">): string {
  const ref = ROTULO_REFERENCIA[e.referencia];
  const dias = Math.abs(e.offsetDias);
  const quando =
    e.offsetDias === 0
      ? `No dia do ${ref}`
      : e.offsetDias < 0
        ? `${dias} ${dias === 1 ? "dia" : "dias"} antes do ${ref}`
        : `${dias} ${dias === 1 ? "dia" : "dias"} depois do ${ref}`;
  return `${quando}, às ${e.hora}`;
}

/** Versão curta, para caber no marcador da linha do tempo. */
export function rotuloCurto(e: Pick<EtapaRegua, "offsetDias">): string {
  if (e.offsetDias === 0) return "D";
  return e.offsetDias < 0 ? `D${e.offsetDias}` : `D+${e.offsetDias}`;
}
