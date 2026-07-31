"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Botao, Campo, Input, Switch } from "@/components/ui";
import { Icon, Logo, type IconName } from "@/components/icons";
import { FEATURES } from "@/lib/plans";
import { useApp } from "@/lib/store";

interface Erros {
  nomeEmpresa?: string;
  email?: string;
  whatsapp?: string;
  senha?: string;
  aceite?: string;
}

export default function CadastroPage() {
  const app = useApp();
  const router = useRouter();

  const [nomeEmpresa, setNomeEmpresa] = useState("");
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [senha, setSenha] = useState("");
  const [aceite, setAceite] = useState(false);
  const [erros, setErros] = useState<Erros>({});

  function aoEnviar(e: FormEvent) {
    e.preventDefault();

    const proximosErros: Erros = {};
    if (!nomeEmpresa.trim())
      proximosErros.nomeEmpresa = "Conte o nome da sua empresa.";
    if (!email.trim()) proximosErros.email = "Informe um e-mail.";
    if (!whatsapp.trim())
      proximosErros.whatsapp = "Informe o WhatsApp da empresa.";
    if (!senha.trim()) proximosErros.senha = "Crie uma senha.";
    else if (senha.trim().length < 6)
      proximosErros.senha = "Use pelo menos 6 caracteres.";
    if (!aceite)
      proximosErros.aceite = "Você precisa aceitar os termos para continuar.";

    setErros(proximosErros);
    if (Object.keys(proximosErros).length > 0) return;

    app.comecarCadastro(email, nomeEmpresa);
    router.push("/onboarding");
  }

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

          <form onSubmit={aoEnviar} className="mt-8 space-y-4" noValidate>
            <Campo
              label="Nome da empresa"
              obrigatorio
              erro={erros.nomeEmpresa}
            >
              <Input
                placeholder="Ex: Clínica Vitalis"
                value={nomeEmpresa}
                onChange={(e) => setNomeEmpresa(e.target.value)}
              />
            </Campo>
            <Campo label="E-mail" obrigatorio erro={erros.email}>
              <Input
                type="email"
                placeholder="voce@empresa.com.br"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </Campo>
            <Campo label="WhatsApp" obrigatorio erro={erros.whatsapp}>
              <Input
                placeholder="(11) 98765-4321"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                autoComplete="tel"
              />
            </Campo>
            <Campo
              label="Senha"
              obrigatorio
              dica="Pelo menos 6 caracteres."
              erro={erros.senha}
            >
              <Input
                type="password"
                placeholder="Crie uma senha"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                autoComplete="new-password"
              />
            </Campo>

            <div className="pt-1">
              <Switch
                ativo={aceite}
                onChange={setAceite}
                label="Aceito os termos de uso e a política de privacidade"
                descricao="Protótipo — nenhum documento real é aplicado aqui."
              />
              {erros.aceite && (
                <p className="mt-1.5 text-xs text-rose-600">{erros.aceite}</p>
              )}
            </div>

            <Botao type="submit" variante="primario" tamanho="lg" className="w-full">
              Criar minha conta
            </Botao>
          </form>

          <p className="mt-6 text-center text-[13.5px] text-ink-500">
            Já tenho conta.{" "}
            <Link href="/entrar" className="font-medium text-brand-700 hover:underline">
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
          {(["atendimento", "cobranca", "agendamento"] as const).map(
            (chave) => {
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
            },
          )}
        </div>

        <div className="relative flex items-center gap-2 border-t border-white/15 pt-6 text-[13.5px] text-brand-100">
          <Icon name="check" className="size-4 shrink-0 text-white" />
          Sem cartão de crédito para começar.
        </div>
      </div>
    </div>
  );
}
