import Link from "next/link";
import { redirect } from "next/navigation";

import { Icon, Logo, type IconName } from "@/components/icons";
import { FEATURES } from "@/lib/plans";
import { getContexto } from "@/server/dal/contexto";
import { FormCadastro } from "./form";

export const metadata = { title: "Criar conta · AutoFlow" };

export default async function CadastroPage() {
  const ctx = await getContexto();
  if (ctx) redirect(ctx.onboardingCompleto ? "/painel" : "/onboarding");

  return (
    <div className="flex min-h-screen">
      {/* Coluna do formulário */}
      <div className="flex w-full flex-col justify-center px-6 py-12 sm:px-10 lg:w-1/2 lg:px-16">
        <div className="mx-auto w-full max-w-sm">
          <Link href="/" className="inline-flex items-center gap-2">
            <Logo className="size-8" />
            <span className="text-[15px] font-semibold text-ink-900">
              AutoFlow
            </span>
          </Link>

          <h1 className="mt-8 text-2xl font-semibold tracking-tight text-ink-950">
            Criar sua conta
          </h1>
          <p className="mt-1.5 text-[14px] text-ink-500">
            Leva menos de um minuto. Depois é só conectar o WhatsApp.
          </p>

          <FormCadastro />

          <p className="mt-6 text-center text-[13.5px] text-ink-500">
            Já tenho conta.{" "}
            <Link
              href="/entrar"
              className="font-medium text-brand-700 hover:underline"
            >
              Entrar
            </Link>
          </p>
        </div>
      </div>

      {/* Coluna decorativa */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-brand-800 p-12 lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, rgba(255,255,255,0.15) 0, transparent 40%), radial-gradient(circle at 80% 70%, rgba(255,255,255,0.12) 0, transparent 45%)",
          }}
        />
        <div className="relative">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-[13px] font-medium text-white">
            <Icon name="bolt" className="size-4" />
            Comece a atender em minutos
          </span>
        </div>

        <div className="relative space-y-5">
          {(["atendimento", "cobranca", "agendamento"] as const).map((chave) => {
            const feat = FEATURES[chave];
            return (
              <div key={chave} className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white">
                  <Icon name={feat.icone as IconName} className="size-4.5" />
                </span>
                <div>
                  <p className="text-[15px] font-semibold text-white">
                    {feat.nome}
                  </p>
                  <p className="mt-0.5 text-[13.5px] text-brand-100">
                    {feat.descricao}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="relative flex items-center gap-2 border-t border-white/15 pt-6 text-[13.5px] text-brand-100">
          <Icon name="check" className="size-4 shrink-0 text-white" />
          Sem cartão de crédito para começar.
        </div>
      </div>
    </div>
  );
}
