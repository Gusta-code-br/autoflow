"use server";

import { refresh } from "next/cache";

import type { EstadoForm } from "@/lib/form";
import {
  alternarAtiva,
  arquivarRegua,
  definirPadrao,
  duplicarRegua,
  EntradaRegua,
  salvarRegua,
} from "@/server/dal/reguas";
import { marcado, opcional, paraEstado, texto } from "./comum";

/**
 * Ações do editor de régua.
 *
 * O editor é um formulário aninhado (n etapas, cada uma com 8 campos) e o
 * usuário arrasta, duplica e apaga linha antes de salvar. Mandar isso como
 * `etapas[3][hora]` seria possível, mas transformaria a ordem — que é dado
 * semântico aqui — em detalhe do nome do input. O cliente serializa o desenho
 * em JSON num campo só; o servidor não confia nele e valida tudo de novo com o
 * mesmo schema que a DAL usa.
 */

export async function salvarReguaAction(
  _anterior: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const id = opcional(form, "id");

  let etapasBrutas: unknown;
  try {
    etapasBrutas = JSON.parse(texto(form, "etapas") || "[]");
  } catch {
    // Só acontece com JS quebrado ou POST forjado. Não vale poluir a tela com
    // detalhe técnico.
    return { ok: false, erro: "Não consegui ler as etapas. Recarregue a página." };
  }

  try {
    const entrada = EntradaRegua.parse({
      nome: texto(form, "nome"),
      descricao: opcional(form, "descricao"),
      ativa: marcado(form, "ativa"),
      aplicarA: texto(form, "aplicarA") || "todas",
      tag: opcional(form, "tag"),
      pausarAoResponder: marcado(form, "pausarAoResponder"),
      pausarAoPagar: marcado(form, "pausarAoPagar"),
      padrao: marcado(form, "padrao"),
      etapas: etapasBrutas,
    });

    const r = await salvarRegua(entrada, id);
    refresh();

    // Os avisos são o valor real da resposta: "3 cobranças continuam com o
    // desenho antigo" é exatamente o que o usuário não imagina sozinho.
    return {
      ok: true,
      mensagem: ["Régua salva.", ...r.avisos].join(" "),
    };
  } catch (e) {
    // Erro dentro de etapa chega com caminho `etapas.2.mensagem` — é o que a
    // tela usa para abrir a etapa certa e destacar o campo.
    return paraEstado(e);
  }
}

export async function definirPadraoAction(
  _anterior: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  try {
    await definirPadrao(texto(form, "id"));
  } catch (e) {
    return paraEstado(e);
  }

  refresh();
  return { ok: true, mensagem: "Régua definida como padrão para novas cobranças." };
}

export async function alternarAtivaAction(
  _anterior: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const ativa = marcado(form, "ativa");

  try {
    await alternarAtiva(texto(form, "id"), ativa);
  } catch (e) {
    return paraEstado(e);
  }

  refresh();
  return {
    ok: true,
    mensagem: ativa
      ? "Régua ativada. Ela vale para as próximas cobranças."
      : "Régua pausada. As cobranças já em andamento continuam.",
  };
}

export async function arquivarReguaAction(
  _anterior: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  let canceladas = 0;

  try {
    ({ canceladas } = await arquivarRegua(texto(form, "id")));
  } catch (e) {
    return paraEstado(e);
  }

  refresh();
  return {
    ok: true,
    mensagem:
      canceladas > 0
        ? `Régua arquivada. ${canceladas} ${
            canceladas === 1 ? "mensagem agendada foi cancelada" : "mensagens agendadas foram canceladas"
          }.`
        : "Régua arquivada.",
  };
}

export async function duplicarReguaAction(
  _anterior: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  try {
    await duplicarRegua(texto(form, "id"));
  } catch (e) {
    return paraEstado(e);
  }

  refresh();
  return { ok: true, mensagem: "Cópia criada, pausada, pronta para você editar." };
}
