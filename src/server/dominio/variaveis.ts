/**
 * Variáveis de mensagem ({{nome}}, {{valor}}…) e a ponte para o formato de
 * template da Meta, que só aceita posicionais ({{1}}, {{2}}).
 *
 * Duas regras que evitam incidente:
 *  1. Variável desconhecida ou vazia derruba o envio — mensagem com "Olá {{nome}},"
 *     literal chegando no cliente é pior que não enviar.
 *  2. Nada de interpolar direto no corpo sem passar por aqui.
 */

import { formatarBRL } from "./dinheiro";
import { type DataLocal } from "./tempo";

export const VARIAVEIS_MENSAGEM = {
  nome: "Primeiro nome do cliente",
  nome_completo: "Nome completo do cliente",
  valor: "Valor da cobrança (R$ 1.234,56)",
  vencimento: "Data de vencimento (10/08/2026)",
  descricao: "Descrição da cobrança",
  dias_atraso: "Dias de atraso (0 se em dia)",
  empresa: "Nome da sua empresa",
  atendente: "Nome de quem atende",
  link_pagamento: "Link de pagamento / PIX copia e cola",
} as const;

export type ChaveVariavel = keyof typeof VARIAVEIS_MENSAGEM;

export interface ContextoMensagem {
  nomeCompleto: string;
  valorCentavos: number;
  vencimento: DataLocal;
  descricao?: string | null;
  diasAtraso: number;
  empresa: string;
  atendente?: string | null;
  linkPagamento?: string | null;
}

const RE_VARIAVEL = /\{\{\s*([a-z_]+)\s*\}\}/g;

function formatarDataBR(data: DataLocal): string {
  const [ano, mes, dia] = data.split("-");
  return `${dia}/${mes}/${ano}`;
}

export function valoresDoContexto(
  ctx: ContextoMensagem,
): Record<ChaveVariavel, string> {
  const primeiroNome = ctx.nomeCompleto.trim().split(/\s+/)[0] ?? "";
  return {
    nome: primeiroNome,
    nome_completo: ctx.nomeCompleto.trim(),
    valor: formatarBRL(ctx.valorCentavos),
    vencimento: formatarDataBR(ctx.vencimento),
    descricao: (ctx.descricao ?? "").trim(),
    dias_atraso: String(Math.max(0, ctx.diasAtraso)),
    empresa: ctx.empresa.trim(),
    atendente: (ctx.atendente ?? "").trim(),
    link_pagamento: (ctx.linkPagamento ?? "").trim(),
  };
}

/** Nomes de variáveis usados no texto, na ordem de aparição, sem repetir. */
export function extrairVariaveis(texto: string): string[] {
  const achadas: string[] = [];
  for (const m of texto.matchAll(RE_VARIAVEL)) {
    if (!achadas.includes(m[1])) achadas.push(m[1]);
  }
  return achadas;
}

export interface ResultadoValidacao {
  ok: boolean;
  desconhecidas: string[];
}

export function validarTemplate(texto: string): ResultadoValidacao {
  const desconhecidas = extrairVariaveis(texto).filter(
    (v) => !(v in VARIAVEIS_MENSAGEM),
  );
  return { ok: desconhecidas.length === 0, desconhecidas };
}

export class VariavelVaziaError extends Error {
  constructor(readonly variaveis: string[]) {
    super(`variáveis sem valor: ${variaveis.join(", ")}`);
    this.name = "VariavelVaziaError";
  }
}

export interface OpcoesPreenchimento {
  /** Preview aceita valores vazios; envio real não. */
  permitirVazias?: boolean;
}

export function preencherVariaveis(
  texto: string,
  ctx: ContextoMensagem,
  opcoes: OpcoesPreenchimento = {},
): string {
  const valores = valoresDoContexto(ctx);
  const vazias: string[] = [];

  // Opcionais: mensagem funciona sem elas.
  const podemFicarVazias = new Set<string>([
    "descricao",
    "atendente",
    "link_pagamento",
  ]);

  const saida = texto.replace(RE_VARIAVEL, (bruto, chave: string) => {
    if (!(chave in valores)) {
      if (!opcoes.permitirVazias) vazias.push(chave);
      return bruto;
    }
    const valor = valores[chave as ChaveVariavel];
    if (!valor && !podemFicarVazias.has(chave)) vazias.push(chave);
    return valor;
  });

  if (vazias.length > 0 && !opcoes.permitirVazias) {
    throw new VariavelVaziaError([...new Set(vazias)]);
  }

  // Espaço duplo e linha órfã deixados por variável opcional vazia.
  return saida
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface TemplateMeta {
  /** Corpo com posicionais: 'Olá {{1}}, sua cobrança de {{2}}…' */
  corpo: string;
  /** Ordem dos nomes: índice 0 → {{1}}. Vai para `template.variaveis_map`. */
  ordem: string[];
}

/**
 * Converte o template escrito pelo usuário no formato que a Meta aprova.
 * A ordem é gravada junto porque, na hora do envio, os parâmetros precisam ser
 * montados exatamente nessa sequência.
 */
export function paraTemplateMeta(texto: string): TemplateMeta {
  const ordem = extrairVariaveis(texto);
  const corpo = texto.replace(RE_VARIAVEL, (bruto, chave: string) => {
    const i = ordem.indexOf(chave);
    return i === -1 ? bruto : `{{${i + 1}}}`;
  });
  return { corpo, ordem };
}

/** Parâmetros posicionais para o payload da Cloud API, na ordem do template. */
export function parametrosMeta(
  ordem: string[],
  ctx: ContextoMensagem,
): string[] {
  const valores = valoresDoContexto(ctx);
  return ordem.map((chave) => valores[chave as ChaveVariavel] ?? "");
}
