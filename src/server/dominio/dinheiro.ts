/**
 * Dinheiro é `bigint` de centavos no banco e `number` de centavos aqui.
 * Nunca float de reais: 0.1 + 0.2 e amigos viram divergência de conciliação.
 */

export const CENTAVOS_MAX = 100_000_000_00; // R$ 100 milhões: trava contra erro de digitação

export function reaisParaCentavos(reais: number): number {
  if (!Number.isFinite(reais)) throw new Error("valor não numérico");
  // toFixed antes de Math.round evita 19.99 * 100 = 1998.9999999999998
  return Math.round(Number(reais.toFixed(2)) * 100);
}

export function centavosParaReais(centavos: number): number {
  return centavos / 100;
}

/**
 * Aceita o que o usuário digita: '1.234,56', 'R$ 1234.56', '1234', '99,9'.
 * Devolve centavos ou null.
 */
export function parseValorBR(texto: string | null | undefined): number | null {
  if (texto === null || texto === undefined) return null;
  let s = String(texto).trim().replace(/[R$\s ]/gi, "");
  if (!s) return null;

  const temVirgula = s.includes(",");
  const temPonto = s.includes(".");

  if (temVirgula && temPonto) {
    // O último separador manda: '1.234,56' (BR) vs '1,234.56' (US)
    s = s.lastIndexOf(",") > s.lastIndexOf(".")
      ? s.replace(/\./g, "").replace(",", ".")
      : s.replace(/,/g, "");
  } else if (temVirgula) {
    s = s.replace(",", ".");
  } else if (temPonto) {
    // '1.234' é milhar; '1.23' é decimal.
    const dec = s.slice(s.lastIndexOf(".") + 1);
    if (dec.length === 3) s = s.replace(/\./g, "");
  }

  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;

  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;

  const centavos = reaisParaCentavos(n);
  return centavos > CENTAVOS_MAX ? null : centavos;
}

const FMT_BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatarBRL(centavos: number | bigint): string {
  const n = typeof centavos === "bigint" ? Number(centavos) : centavos;
  return FMT_BRL.format(n / 100);
}

/** Soma que não deixa passar valor quebrado por engano. */
export function somarCentavos(...valores: number[]): number {
  let total = 0;
  for (const v of valores) {
    if (!Number.isInteger(v)) throw new Error(`centavos não inteiro: ${v}`);
    total += v;
  }
  return total;
}

/**
 * Divide um valor em N parcelas sem perder centavo: a diferença do
 * arredondamento vai para a primeira parcela.
 */
export function parcelar(centavos: number, parcelas: number): number[] {
  if (!Number.isInteger(centavos) || centavos < 0) {
    throw new Error("valor inválido para parcelamento");
  }
  if (!Number.isInteger(parcelas) || parcelas < 1) {
    throw new Error("número de parcelas inválido");
  }
  const base = Math.floor(centavos / parcelas);
  const resto = centavos - base * parcelas;
  return Array.from({ length: parcelas }, (_, i) => base + (i === 0 ? resto : 0));
}
