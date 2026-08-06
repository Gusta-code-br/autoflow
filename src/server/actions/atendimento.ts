"use server";

import { refresh } from "next/cache";

import type { EstadoForm } from "@/lib/form";
import {
  arquivarConversa,
  definirModo,
  marcarLida,
  responderConversa,
} from "@/server/dal/atendimento";
import { exigirContexto } from "@/server/dal/contexto";
import { consumir } from "@/server/seguranca/limite";
import { paraEstado, texto } from "./comum";

/**
 * Caixa de entrada: responder, assumir/devolver, arquivar.
 *
 * `refresh()` em vez de `revalidatePath`: a thread é conteúdo dinâmico por
 * usuário e não tem cache de rota para invalidar — o que se quer é re-renderizar
 * a árvore atual no lugar, mantendo o scroll e o texto dos outros campos.
 */

export async function responderAction(
  _anterior: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const conversaId = texto(form, "conversaId");
  const mensagem = texto(form, "texto");

  try {
    const ctx = await exigirContexto();

    // Limite por usuário, não por org: um operador com macro maluca não pode
    // gastar a cota (e os créditos) do time inteiro.
    const limite = await consumir("envioManual", `${ctx.orgId}:${ctx.usuarioId}`);
    if (!limite.permitido) {
      return {
        ok: false,
        erro: `Muitos envios seguidos. Tente de novo em ${Math.ceil(limite.esperarSeg / 60)} min.`,
        valores: { texto: mensagem },
      };
    }

    const r = await responderConversa(conversaId, mensagem);
    if (!r.ok) return { ok: false, erro: r.erro, valores: { texto: mensagem } };

    refresh();
    return { ok: true };
  } catch (e) {
    return paraEstado(e, { texto: mensagem });
  }
}

export async function assumirAction(
  _anterior: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  try {
    const modo = texto(form, "modo") === "humano" ? "humano" : "ia";
    await definirModo(texto(form, "conversaId"), modo);
    refresh();
    return {
      ok: true,
      mensagem:
        modo === "humano"
          ? "Você assumiu esta conversa."
          : "Conversa devolvida para a IA.",
    };
  } catch (e) {
    return paraEstado(e);
  }
}

export async function arquivarConversaAction(
  _anterior: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  try {
    const arquivar = texto(form, "arquivar") !== "false";
    await arquivarConversa(texto(form, "conversaId"), arquivar);
    refresh();
    return {
      ok: true,
      mensagem: arquivar ? "Conversa arquivada." : "Conversa reaberta.",
    };
  } catch (e) {
    return paraEstado(e);
  }
}

/**
 * Zera o contador de não lidas ao abrir a conversa.
 *
 * Sem `refresh()`: quem chama já está renderizando a thread, e re-renderizar
 * por causa de um badge faria a tela piscar no meio da leitura. O número certo
 * chega na próxima navegação.
 */
export async function marcarLidaAction(conversaId: string): Promise<void> {
  try {
    await marcarLida(conversaId);
  } catch (e) {
    console.error("[marcarLida]", e);
  }
}
