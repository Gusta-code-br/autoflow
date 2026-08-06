"use client";

import { useActionState } from "react";

import { AvisoForm, BotaoEnviar, erroDe, valorDe } from "@/components/form";
import { Campo, Input } from "@/components/ui";
import { ESTADO_INICIAL } from "@/lib/form";
import { cadastrarAction } from "@/server/actions/auth";

export function FormCadastro() {
  const [estado, acao] = useActionState(cadastrarAction, ESTADO_INICIAL);

  return (
    <form action={acao} className="mt-8 space-y-4">
      <AvisoForm estado={estado} />

      <Campo label="Seu nome" obrigatorio erro={erroDe(estado, "nome")}>
        <Input
          name="nome"
          placeholder="Ex: Fernanda Reis"
          defaultValue={valorDe(estado, "nome")}
          autoComplete="name"
          required
        />
      </Campo>
      <Campo
        label="Nome da empresa"
        obrigatorio
        erro={erroDe(estado, "nomeEmpresa")}
      >
        <Input
          name="nomeEmpresa"
          placeholder="Ex: Clínica Vitalis"
          defaultValue={valorDe(estado, "nomeEmpresa")}
          autoComplete="organization"
          required
        />
      </Campo>
      <Campo label="E-mail" obrigatorio erro={erroDe(estado, "email")}>
        <Input
          name="email"
          type="email"
          placeholder="voce@empresa.com.br"
          defaultValue={valorDe(estado, "email")}
          autoComplete="email"
          required
        />
      </Campo>
      <Campo
        label="WhatsApp"
        dica="Usamos para te avisar de novidades da conta."
        erro={erroDe(estado, "telefone")}
      >
        <Input
          name="telefone"
          placeholder="(11) 98765-4321"
          defaultValue={valorDe(estado, "telefone")}
          autoComplete="tel"
        />
      </Campo>
      <Campo
        label="Senha"
        obrigatorio
        dica="Pelo menos 8 caracteres."
        erro={erroDe(estado, "senha")}
      >
        <Input
          name="senha"
          type="password"
          placeholder="Crie uma senha"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </Campo>

      <BotaoEnviar
        variante="primario"
        tamanho="lg"
        className="w-full"
        enviando="Criando conta..."
      >
        Criar minha conta
      </BotaoEnviar>

      <p className="text-center text-[12.5px] leading-relaxed text-ink-400">
        Ao criar a conta você aceita os termos de uso e a política de
        privacidade.
      </p>
    </form>
  );
}
