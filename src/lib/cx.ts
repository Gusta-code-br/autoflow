/**
 * Junta classes condicionais.
 *
 * Mora aqui, e não em `components/ui.tsx`, porque aquele arquivo é
 * `"use client"`: tudo que ele exporta vira referência de cliente, e um Server
 * Component que chamasse `cx()` na hora de montar o className quebraria com
 * "Attempted to call cx() from the server". Sendo um módulo neutro, os dois
 * lados usam a mesma função.
 */
export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(" ");
}
