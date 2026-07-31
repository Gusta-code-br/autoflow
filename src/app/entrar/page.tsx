"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Botao, Campo, Input } from "@/components/ui";
import { Icon, Logo } from "@/components/icons";
import { useApp } from "@/lib/store";

export default function EntrarPage() {
  const app = useApp();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");

  function aoEnviar(e: FormEvent) {
    e.preventDefault();
    app.entrar();
    router.push("/painel");
  }

  function entrarDemo() {
    app.carregarDemo();
    router.push("/painel");
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
            Entrar na sua conta
          </h1>
          <p className="mt-1.5 text-[14px] text-ink-500">
            Acesse o painel e continue de onde parou.
          </p>

          <form onSubmit={aoEnviar} className="mt-8 space-y-4">
            <Campo label="E-mail" obrigatorio>
              <Input
                type="email"
                placeholder="voce@empresa.com.br"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </Campo>
            <Campo label="Senha" obrigatorio>
              <Input
                type="password"
                placeholder="Sua senha"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                autoComplete="current-password"
              />
            </Campo>

            <Botao type="submit" variante="primario" tamanho="lg" className="w-full">
              Entrar
            </Botao>
          </form>

          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-ink-200" />
            <span className="text-[12px] text-ink-400">ou</span>
            <span className="h-px flex-1 bg-ink-200" />
          </div>

          <Botao
            variante="zap"
            tamanho="lg"
            icone="spark"
            className="w-full"
            onClick={entrarDemo}
          >
            Entrar na conta de demonstração
          </Botao>
          <p className="mt-2 text-center text-[12px] text-ink-400">
            Explore o painel completo já preenchido com dados de exemplo.
          </p>

          <p className="mt-8 text-center text-[13.5px] text-ink-500">
            Ainda não tem conta?{" "}
            <Link href="/cadastro" className="font-medium text-brand-700 hover:underline">
              Criar conta
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
            <Icon name="whatsapp" className="size-4" />
            IA conectada 24h no WhatsApp
          </span>
        </div>

        <div className="relative">
          <blockquote className="text-2xl font-medium leading-snug text-white">
            &ldquo;Parei de perder cliente por demora no WhatsApp. A IA
            responde na hora e ainda cobra quem está atrasado.&rdquo;
          </blockquote>
          <p className="mt-4 text-[14px] text-brand-100">
            Fernanda Reis · Clínica Vitalis
          </p>
        </div>

        <div className="relative grid grid-cols-3 gap-6 border-t border-white/15 pt-6">
          <div>
            <p className="text-2xl font-semibold text-white">24h</p>
            <p className="mt-1 text-[12.5px] text-brand-100">
              Atendimento sem pausa
            </p>
          </div>
          <div>
            <p className="text-2xl font-semibold text-white">3x</p>
            <p className="mt-1 text-[12.5px] text-brand-100">
              Mais cobranças recuperadas
            </p>
          </div>
          <div>
            <p className="text-2xl font-semibold text-white">5 min</p>
            <p className="mt-1 text-[12.5px] text-brand-100">
              Para conectar o WhatsApp
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
