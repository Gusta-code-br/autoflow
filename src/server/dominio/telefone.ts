/**
 * Normalização de telefone para E.164 — a chave de identidade do contato.
 *
 * Por que isso é regra de negócio e não máscara de formulário: o mesmo cliente
 * chega como "(11) 99123-4501" pelo formulário e como "5511991234501" pelo
 * webhook da Meta. Se cada um virar uma linha em `contato`, o opt-out não vale
 * para os dois e o histórico se parte em dois.
 */

const DDD_VALIDOS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35,
  37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64,
  65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88,
  89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

/**
 * Converte entrada humana em E.164 ('+5511991234501'). Devolve null se não der
 * para confiar no número — melhor recusar do que gravar lixo que vira mensagem
 * para estranho.
 */
export function normalizarE164(
  entrada: string | null | undefined,
  paisPadrao = "55",
): string | null {
  if (!entrada) return null;

  // Sinal explícito de "isto já é um número internacional completo": o
  // usuário digitou o '+'. Sem isso não dá para distinguir, por exemplo, um
  // celular português de 11 dígitos de um DDD+celular brasileiro também de
  // 11 dígitos — o '+' tira a ambiguidade e evita tentar decifrar DDD de
  // outro país como se fosse daqui.
  const internacionalExplicito = entrada.trim().startsWith("+");

  let d = entrada.replace(/\D/g, "");
  if (!d) return null;

  // 00 como prefixo internacional discado
  if (d.startsWith("00")) d = d.slice(2);

  // Número de outro país: com '+' explícito, ou sem ele mas claramente maior
  // que um número nacional (>11 dígitos e não começa com o código do país
  // padrão). Aceita como veio, sem tentar aplicar regra de DDD/9º dígito.
  if (
    !d.startsWith(paisPadrao) &&
    (internacionalExplicito || d.length > 11)
  ) {
    return d.length >= 8 && d.length <= 15 ? `+${d}` : null;
  }

  if (d.startsWith(paisPadrao)) d = d.slice(paisPadrao.length);

  // Operadora discada (0xx) ou tronco: 021 11 9... → 11 9...
  if (d.length > 11 && d.startsWith("0")) d = d.replace(/^0\d{0,2}/, "");
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);

  if (d.length < 10 || d.length > 11) return null;

  const ddd = Number(d.slice(0, 2));
  if (!DDD_VALIDOS.has(ddd)) return null;

  let assinante = d.slice(2);

  /**
   * O nono dígito. Celular no Brasil tem 9 dígitos começando com 9, mas
   * cadastros antigos e alguns payloads do WhatsApp trazem 8 dígitos. Se o
   * primeiro dígito for de faixa móvel (6–9), repõe o 9 — senão o mesmo
   * cliente vira dois contatos.
   */
  if (assinante.length === 8 && /^[6-9]/.test(assinante)) {
    assinante = `9${assinante}`;
  }

  // Fixo (8 dígitos, começa em 2–5) permanece com 8.
  if (assinante.length === 8 && !/^[2-5]/.test(assinante)) return null;
  if (assinante.length === 9 && !/^9/.test(assinante)) return null;

  return `+${paisPadrao}${ddd}${assinante}`;
}

/** '+5511991234501' → '(11) 99123-4501' (exibição). */
export function formatarTelefoneBR(e164: string | null | undefined): string {
  if (!e164) return "";
  const d = e164.replace(/\D/g, "");
  if (!d.startsWith("55")) return e164;

  const nacional = d.slice(2);
  const ddd = nacional.slice(0, 2);
  const resto = nacional.slice(2);

  if (resto.length === 9) return `(${ddd}) ${resto.slice(0, 5)}-${resto.slice(5)}`;
  if (resto.length === 8) return `(${ddd}) ${resto.slice(0, 4)}-${resto.slice(4)}`;
  return e164;
}

/** Formato que a Meta Cloud API espera no campo `to`: dígitos, sem '+'. */
export function paraMetaWaId(e164: string): string {
  return e164.replace(/\D/g, "");
}

export function mesmoNumero(a: string, b: string): boolean {
  const na = normalizarE164(a);
  const nb = normalizarE164(b);
  return na !== null && na === nb;
}
