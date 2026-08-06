"use server";

import { refresh } from "next/cache";

import type { EstadoForm } from "@/lib/form";
import {
  conectarCanal,
  CredencialInvalidaError,
  definirPrincipal,
  desconectarCanal,
  entradaConexao,
  LimiteConexoesError,
  renomearCanal,
  testarConexao,
} from "@/server/dal/conexoes";
import { opcional, paraEstado, texto } from "./comum";

/**
 * Ações da tela de conexões.
 *
 * Duas coisas moldam este arquivo:
 *
 * 1. Conectar é a única ação do produto que fala com um serviço de terceiro
 *    antes de gravar. Quando a Meta responde "token inválido", isso não é uma
 *    falha genérica — é um campo específico do formulário que está errado, e a
 *    tela precisa saber qual. Por isso `CredencialInvalidaError` carrega o
 *    `codigo` e aqui ele vira `campos`.
 *
 * 2. O `webhookUrl` da Evolution aparece uma vez só, no retorno de quem acabou
 *    de conectar — não é lido do banco depois (guardamos só o hash). Como
 *    `EstadoForm` não tem campo para isso, ele vai dentro da `mensagem`: é o
 *    passo seguinte obrigatório do onboarding, não um detalhe decorativo.
 */

/** Mapa de código do provedor para o `name` do input correspondente. */
const CAMPO_POR_CODIGO: Record<string, string> = {
  numero: "numero",
  token: "token",
  phoneNumberId: "phoneNumberId",
  baseUrl: "baseUrl",
  instancia: "instancia",
};

export async function conectarCanalAction(
  _anterior: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  // Repovoar o formulário depois do erro importa mais aqui do que em qualquer
  // outra tela: quem colou um token de 200 caracteres da Meta não vai colar de
  // novo de bom humor. O token não é segredo do usuário para o usuário — é ele
  // quem acabou de digitar — então devolvê-lo é seguro e é o certo.
  const valores: Record<string, string> = {
    provedor: texto(form, "provedor"),
    nome: texto(form, "nome"),
    numero: texto(form, "numero"),
    phoneNumberId: opcional(form, "phoneNumberId") ?? "",
    wabaId: opcional(form, "wabaId") ?? "",
    baseUrl: opcional(form, "baseUrl") ?? "",
    instancia: opcional(form, "instancia") ?? "",
  };

  try {
    const entrada = entradaConexao.parse({
      provedor: texto(form, "provedor"),
      nome: texto(form, "nome"),
      numero: texto(form, "numero"),
      phoneNumberId: opcional(form, "phoneNumberId"),
      wabaId: opcional(form, "wabaId"),
      baseUrl: opcional(form, "baseUrl"),
      instancia: opcional(form, "instancia"),
      token: texto(form, "token"),
    });

    const criado = await conectarCanal(entrada);
    refresh();

    if (criado.webhookUrl) {
      // A Evolution não descobre sozinha para onde mandar as respostas. Sem
      // este passo o número envia e nunca recebe — e "pausar ao responder",
      // que é a razão de existir do produto, silenciosamente não funciona.
      return {
        ok: true,
        mensagem:
          `Número ${criado.numero} conectado. Falta um passo: cole esta URL ` +
          `no campo Webhook da sua instância Evolution — ${criado.webhookUrl}`,
      };
    }

    return { ok: true, mensagem: `Número ${criado.numero} conectado.` };
  } catch (e) {
    if (e instanceof LimiteConexoesError) {
      return {
        ok: false,
        erro: `${e.message} Desconecte um número ou compre uma conexão extra.`,
        valores,
      };
    }

    if (e instanceof CredencialInvalidaError) {
      const campo = e.codigo ? CAMPO_POR_CODIGO[e.codigo] : undefined;
      return {
        ok: false,
        erro: e.message,
        campos: campo ? { [campo]: e.message } : undefined,
        valores,
      };
    }

    return paraEstado(e, valores);
  }
}

export async function testarConexaoAction(
  _anterior: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  try {
    const r = await testarConexao(texto(form, "canalId"));

    // Testar sempre grava o resultado no canal (status, qualidade, último
    // erro). Mesmo quando falha, a tela abaixo mudou — daí o refresh nos dois
    // caminhos.
    refresh();

    return r.ok ? { ok: true, mensagem: r.mensagem } : { ok: false, erro: r.mensagem };
  } catch (e) {
    return paraEstado(e);
  }
}

export async function desconectarCanalAction(
  _anterior: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  try {
    await desconectarCanal(texto(form, "canalId"));
    refresh();
    return {
      ok: true,
      mensagem: "Número desconectado. O histórico de conversas continua aqui.",
    };
  } catch (e) {
    return paraEstado(e);
  }
}

export async function definirPrincipalAction(
  _anterior: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  try {
    await definirPrincipal(texto(form, "canalId"));
    refresh();
    return { ok: true, mensagem: "Número principal atualizado." };
  } catch (e) {
    return paraEstado(e);
  }
}

export async function renomearCanalAction(
  _anterior: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const nome = texto(form, "nome");

  try {
    await renomearCanal(texto(form, "canalId"), nome);
    refresh();
    return { ok: true, mensagem: "Nome atualizado." };
  } catch (e) {
    return paraEstado(e, { nome });
  }
}
