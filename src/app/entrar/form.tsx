"use client";

import { useActionState } from "react";

import { AvisoForm, BotaoEnviar, valorDe } from "@/components/form";
import { Campo, Input } from "@/components/ui";
import { ESTADO_INICIAL } from "@/lib/form";
import { entrarAction } from "@/server/actions/auth";

export function FormEntrar({ destino }: { destino: string }) {
  const [estado, acao] = useActionState(entrarAction, ESTADO_INICIAL);

  return (
    <form action={acao} className="mt-8 space-y-4">
      {/* Para onde voltar depois do login. A action passa por `destinoSeguro`,
          então um link com ?destino=https://site-falso não leva ninguém. */}
      <input type="hidden" name="destino" value={destino} />

      <AvisoForm estado={estado} />

      <Campo label="E-mail" obrigatorio>
        <Input
          name="email"
          type="email"
          placeholder="voce@empresa.com.br"
          defaultValue={valorDe(estado, "email")}
          autoComplete="email"
          required
        />
      </Campo>
      <Campo label="Senha" obrigatorio>
        <Input
          name="senha"
          type="password"
          placeholder="Sua senha"
          autoComplete="current-password"
          required
        />
      </Campo>

      <BotaoEnviar
        variante="primario"
        tamanho="lg"
        className="w-full"
        enviando="Entrando..."
      >
        Entrar
      </BotaoEnviar>
    </form>
  );
}
