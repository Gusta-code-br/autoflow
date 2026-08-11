"use server";

import { refresh } from "next/cache";

import type { EstadoForm } from "@/lib/form";
import {
  contratarPlano,
  definirRenovacao,
} from "@/server/dal/creditos";
import { formatarBRL } from "@/server/dominio/dinheiro";
import { paraEstado, texto } from "./comum";

/**
 * Plano e faturas.
 *
 * Nenhuma destas ações libera nada: todas criam um pagamento pendente e
 * devolvem o que a tela precisa mostrar. Quem troca o plano é o
 * webhook do provedor de pagamento, que é a única fonte que sabe se o dinheiro
 * entrou de fato.
 */

const PERIODICIDADES = ["mensal", "semestral", "anual"] as const;

export async function contratarPlanoAction(
  _anterior: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  try {
    const periodicidade = texto(form, "periodicidade");
    if (!PERIODICIDADES.includes(periodicidade as (typeof PERIODICIDADES)[number])) {
      return { ok: false, erro: "Periodicidade inválida." };
    }

    const cobranca = await contratarPlano(
      texto(form, "planoId"),
      periodicidade as (typeof PERIODICIDADES)[number],
    );
    refresh();
    return {
      ok: true,
      mensagem: `Pagamento de ${formatarBRL(cobranca.valor)} criado. O plano muda assim que o PIX for confirmado.`,
      valores: { pagamentoId: cobranca.pagamentoId },
    };
  } catch (e) {
    return paraEstado(e);
  }
}

export async function definirRenovacaoAction(
  _anterior: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  try {
    const automatica = texto(form, "automatica") === "true";
    await definirRenovacao(automatica);
    refresh();
    return {
      ok: true,
      mensagem: automatica
        ? "Renovação automática ligada."
        : "Renovação desligada. Seu acesso continua até o fim do período pago.",
    };
  } catch (e) {
    return paraEstado(e);
  }
}
