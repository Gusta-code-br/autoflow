import { redirect } from "next/navigation";

import { Logo } from "@/components/icons";
import { Card } from "@/components/ui";
import { getContexto } from "@/server/dal/contexto";
import { FormOnboarding } from "./form";

export const metadata = { title: "Configuração inicial · AutoFlow" };

export default async function OnboardingPage() {
  // Mesma divisão do layout do painel: aqui é navegação (redirect amigável),
  // a autorização de verdade é `exigirPapel()` dentro de `salvarOnboarding`.
  const ctx = await getContexto();
  if (!ctx) redirect("/entrar?destino=/onboarding");
  if (ctx.onboardingCompleto) redirect("/painel");

  return (
    <div className="min-h-screen bg-ink-50">
      <header className="border-b border-ink-100 bg-white">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-2 px-6">
          <Logo className="size-7" />
          <span className="text-[15px] font-semibold text-ink-900">
            AutoFlow
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-950">
          Vamos deixar tudo pronto, {ctx.nome.split(" ")[0]}
        </h1>
        <p className="mt-1.5 text-[14px] text-ink-500">
          Três perguntas rápidas e sua atendente já começa a trabalhar.
        </p>

        <Card className="mt-6 p-6 sm:p-8">
          <FormOnboarding nomeEmpresa={ctx.orgNome} segmento={null} />
        </Card>
      </main>
    </div>
  );
}
