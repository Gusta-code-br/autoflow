import { redirect } from "next/navigation";

import { Shell } from "@/components/shell";
import { getContexto } from "@/server/dal/contexto";
import { carregarSessaoPainel } from "@/server/dal/painel";

/**
 * Porta de entrada do app logado.
 *
 * O redirect vive aqui *e* a verificação vive na DAL, de propósito. Este layout
 * é conveniência de navegação (ninguém quer ver erro 500 por ter deslogado em
 * outra aba); a garantia de que dado nenhum vaza é `exigirContexto()` dentro de
 * cada query. Layout sozinho não protege: rotas filhas podem ser requisitadas
 * direto e Server Actions nem passam por layout.
 */
export default async function PainelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getContexto();
  if (!ctx) redirect("/entrar?destino=/painel");
  // Conta sem onboarding é painel vazio: o robô não tem nome, horário nem tom.
  if (!ctx.onboardingCompleto) redirect("/onboarding");

  const sessao = await carregarSessaoPainel();

  return <Shell sessao={sessao}>{children}</Shell>;
}
