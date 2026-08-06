import "server-only";

import { z } from "zod";

import { NaoAutenticadoError, SemPermissaoError } from "@/server/dal/contexto";
import { EmailEmUsoError } from "@/server/dal/organizacao";
import type { EstadoForm } from "@/lib/form";

/**
 * Peças compartilhadas pelas Server Actions.
 *
 * Este arquivo **não** tem `"use server"`: só arquivos de ação têm, e neles
 * todo export vira um endpoint POST público. Helper síncrono aqui dentro não
 * seria nem permitido (a diretiva exige exports async) nem desejável.
 */

// ---------------------------------------------------------------------------
// Leitura de FormData
// ---------------------------------------------------------------------------

/**
 * `FormData.get` devolve `File | string | null`. Um `File` chegando onde se
 * espera texto é o caso clássico de campo renomeado por alguém de fora — vira
 * string vazia e a validação reclama, em vez de "[object File]" no banco.
 */
export function texto(form: FormData, campo: string): string {
  const valor = form.get(campo);
  return typeof valor === "string" ? valor.trim() : "";
}

/** Como `texto`, mas devolve `undefined` no vazio (para campos opcionais). */
export function opcional(form: FormData, campo: string): string | undefined {
  const valor = texto(form, campo);
  return valor === "" ? undefined : valor;
}

/** Checkbox marcado chega como "on"; ausente não chega. */
export function marcado(form: FormData, campo: string): boolean {
  const valor = form.get(campo);
  return valor === "on" || valor === "true" || valor === "1";
}

/** Vários valores com o mesmo `name` (checkbox group, multi-select). */
export function lista(form: FormData, campo: string): string[] {
  return form
    .getAll(campo)
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean);
}

export function listaDeNumeros(form: FormData, campo: string): number[] {
  return lista(form, campo)
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n));
}

// ---------------------------------------------------------------------------
// Erros → EstadoForm
// ---------------------------------------------------------------------------

/**
 * Converte falha do zod em erro por campo.
 *
 * A primeira mensagem de cada caminho é a que fica: quem preencheu errado quer
 * saber o que arrumar, não ler três variações do mesmo problema.
 */
export function deZod(erro: z.ZodError): EstadoForm {
  const campos: Record<string, string> = {};
  for (const issue of erro.issues) {
    const chave = issue.path.join(".") || "_";
    campos[chave] ??= issue.message;
  }
  return {
    ok: false,
    erro: "Confira os campos destacados.",
    campos,
  };
}

/**
 * Tradutor único de exceção para mensagem de tela.
 *
 * Erro que a gente mesmo lançou (`Error` com texto em português vindo da DAL)
 * é seguro mostrar. Qualquer outro vira frase genérica e vai para o log: stack
 * de driver de banco na tela é vazamento de esquema e, pior, não ajuda ninguém.
 */
export function paraEstado(e: unknown, valores?: Record<string, string>): EstadoForm {
  if (e instanceof z.ZodError) return { ...deZod(e), valores };

  if (e instanceof NaoAutenticadoError) {
    return { ok: false, erro: "Sua sessão expirou. Entre de novo.", valores };
  }
  if (e instanceof SemPermissaoError || e instanceof EmailEmUsoError) {
    return { ok: false, erro: e.message, valores };
  }

  // `Error` nu é sempre nosso: a DAL lança assim quando a mensagem foi escrita
  // para o usuário ler ("telefone inválido — confira o DDD"). Falha de infra
  // vem com nome próprio — `PostgresError` do driver, `TypeError`, `RangeError`
  // — e cai no genérico abaixo. Repassar aquelas mostraria SQL na tela.
  if (e instanceof Error && (e.name === "Error" || e.name === "ErroDeUso")) {
    return { ok: false, erro: e.message, valores };
  }

  console.error("[action] falha inesperada:", e);
  return {
    ok: false,
    erro: "Não consegui concluir agora. Tente de novo em instantes.",
    valores,
  };
}

/**
 * Erro cuja mensagem foi escrita para o usuário final ler.
 *
 * A DAL lança `Error` comum com texto em português; marcar com este nome é o
 * que autoriza `paraEstado` a repassar a frase sem medo.
 */
export class ErroDeUso extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDeUso";
  }
}
