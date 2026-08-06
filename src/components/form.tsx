"use client";

import { useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import type { EstadoForm } from "@/lib/form";
import { Icon } from "./icons";
import { Botao, Switch } from "./ui";
import { cx } from "@/lib/cx";

/**
 * Peças compartilhadas por todo formulário que fala com Server Action.
 *
 * Três problemas se repetem em cada tela e são resolvidos aqui uma vez:
 *
 * 1. **Erro do servidor no lugar certo.** `EstadoForm.erro` é o aviso do topo,
 *    `EstadoForm.campos` é o erro embaixo do input. Espalhar essa decisão por
 *    12 páginas garantiria que alguma esquecesse metade.
 * 2. **Botão que sabe que está enviando.** `useFormStatus` só funciona dentro
 *    de um filho do `<form>` — por isso o botão é componente próprio, e não um
 *    `disabled={pending}` escrito na página.
 * 3. **Switch que chega no FormData.** O `Switch` do design system é visual e
 *    controlado; sem um input espelho o servidor nunca receberia o valor.
 */

/* ------------------------------------------------------------------ Aviso */

export function AvisoForm({ estado }: { estado: EstadoForm }) {
  if (estado.erro) {
    return (
      <div
        role="alert"
        className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-[13.5px] text-rose-700"
      >
        <Icon name="alert" className="mt-px size-4 shrink-0" />
        <span>{estado.erro}</span>
      </div>
    );
  }
  if (estado.ok && estado.mensagem) {
    return (
      <div
        role="status"
        className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-[13.5px] text-emerald-700"
      >
        <Icon name="check" className="mt-px size-4 shrink-0" />
        <span>{estado.mensagem}</span>
      </div>
    );
  }
  return null;
}

/* ------------------------------------------------------------------ Botão */

type PropsBotao = Omit<Parameters<typeof Botao>[0], "type" | "disabled">;

/**
 * Submit que se desabilita sozinho enquanto a ação roda.
 *
 * `enviando` troca o rótulo em vez de só girar um spinner: em cobrança e
 * conexão a ação demora (rede externa) e "Conectando..." explica a espera.
 */
export function BotaoEnviar({
  children,
  enviando,
  ...rest
}: PropsBotao & { enviando?: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Botao type="submit" disabled={pending} {...rest}>
      {pending ? (enviando ?? children) : children}
    </Botao>
  );
}

/** Igual ao anterior, para ações destrutivas com confirmação nativa. */
export function BotaoAcao({
  children,
  confirmar,
  ...rest
}: PropsBotao & { confirmar?: string }) {
  const { pending } = useFormStatus();
  return (
    <Botao
      type="submit"
      disabled={pending}
      onClick={(e) => {
        if (confirmar && !window.confirm(confirmar)) e.preventDefault();
      }}
      {...rest}
    >
      {children}
    </Botao>
  );
}

/* --------------------------------------------------------------- Entradas */

/** Erro que a ação devolveu para um campo específico. */
export function erroDe(estado: EstadoForm, campo: string): string | undefined {
  return estado.campos?.[campo];
}

/**
 * Valor para repovoar o campo depois de um erro.
 *
 * Com JS ligado o React nem remonta o form e o DOM guarda o que foi digitado;
 * isso aqui é para o caso sem JS, em que a página volta do servidor zerada.
 */
export function valorDe(
  estado: EstadoForm,
  campo: string,
  padrao = "",
): string {
  return estado.valores?.[campo] ?? padrao;
}

/**
 * Switch com input espelho.
 *
 * Checkbox desmarcado não aparece no FormData, então o valor vai em um
 * `hidden` que sempre existe — as actions leem "1"/"" com `marcado()`.
 */
export function SwitchForm({
  name,
  padrao = false,
  label,
  descricao,
  disabled,
  aoMudar,
}: {
  name: string;
  padrao?: boolean;
  label?: string;
  descricao?: string;
  disabled?: boolean;
  aoMudar?: (v: boolean) => void;
}) {
  const [ativo, setAtivo] = useState(padrao);
  return (
    <>
      <input type="hidden" name={name} value={ativo ? "1" : ""} />
      <Switch
        ativo={ativo}
        onChange={(v) => {
          setAtivo(v);
          aoMudar?.(v);
        }}
        label={label}
        descricao={descricao}
        disabled={disabled}
      />
    </>
  );
}

/**
 * Grupo de opções múltiplas que vira lista no FormData.
 *
 * Usa checkbox de verdade (escondido) em vez de estado + hidden: assim a
 * seleção sobrevive a um POST sem JS e o `lista()` da action recebe todos os
 * valores marcados com o mesmo `name`.
 */
export function Opcoes({
  name,
  itens,
  padrao = [],
  colunas = 1,
}: {
  name: string;
  itens: { valor: string; titulo: string; descricao?: string }[];
  padrao?: string[];
  colunas?: 1 | 2 | 3;
}) {
  return (
    <div
      className={cx(
        "grid gap-2.5",
        colunas === 2 && "sm:grid-cols-2",
        colunas === 3 && "sm:grid-cols-3",
      )}
    >
      {itens.map((item) => (
        <label
          key={item.valor}
          className="group relative flex cursor-pointer items-start gap-3 rounded-xl border border-ink-200 bg-white p-3.5 transition-colors hover:border-ink-300 has-checked:border-brand-500 has-checked:bg-brand-50/60 has-checked:ring-4 has-checked:ring-brand-500/10"
        >
          <input
            type="checkbox"
            name={name}
            value={item.valor}
            defaultChecked={padrao.includes(item.valor)}
            className="peer sr-only"
          />
          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border border-ink-300 text-white transition-colors peer-checked:border-brand-600 peer-checked:bg-brand-600">
            <Icon name="check" className="size-3.5" />
          </span>
          <span className="min-w-0">
            <span className="block text-[14px] font-medium text-ink-800">
              {item.titulo}
            </span>
            {item.descricao && (
              <span className="mt-0.5 block text-[13px] text-ink-500">
                {item.descricao}
              </span>
            )}
          </span>
        </label>
      ))}
    </div>
  );
}

/** Mesma ideia, mas escolha única (radio). */
export function Escolha({
  name,
  itens,
  padrao,
  colunas = 1,
}: {
  name: string;
  itens: { valor: string; titulo: string; descricao?: string }[];
  padrao?: string;
  colunas?: 1 | 2 | 3;
}) {
  return (
    <div
      className={cx(
        "grid gap-2.5",
        colunas === 2 && "sm:grid-cols-2",
        colunas === 3 && "sm:grid-cols-3",
      )}
    >
      {itens.map((item) => (
        <label
          key={item.valor}
          className="flex cursor-pointer items-start gap-3 rounded-xl border border-ink-200 bg-white p-3.5 transition-colors hover:border-ink-300 has-checked:border-brand-500 has-checked:bg-brand-50/60 has-checked:ring-4 has-checked:ring-brand-500/10"
        >
          <input
            type="radio"
            name={name}
            value={item.valor}
            defaultChecked={padrao === item.valor}
            className="peer sr-only"
          />
          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-ink-300 transition-colors peer-checked:border-6 peer-checked:border-brand-600" />
          <span className="min-w-0">
            <span className="block text-[14px] font-medium text-ink-800">
              {item.titulo}
            </span>
            {item.descricao && (
              <span className="mt-0.5 block text-[13px] text-ink-500">
                {item.descricao}
              </span>
            )}
          </span>
        </label>
      ))}
    </div>
  );
}
