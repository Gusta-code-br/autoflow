"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { EstadoForm } from "@/lib/form";

import { Toasts } from "./ui";

/**
 * Avisos de canto de tela.
 *
 * Fica separado do resto do estado porque é a única coisa que sobrou de global
 * no client: dado de negócio vem do servidor a cada navegação, mas "cobrança
 * criada" precisa aparecer depois que a Server Action voltou, sem re-render da
 * página inteira.
 */

export interface Toast {
  id: string;
  texto: string;
  tipo: "sucesso" | "info" | "erro";
}

interface Ctx {
  notificar: (texto: string, tipo?: Toast["tipo"]) => void;
  fechar: (id: string) => void;
}

const ToastCtx = createContext<Ctx | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const fechar = useCallback((id: string) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const notificar = useCallback(
    (texto: string, tipo: Toast["tipo"] = "sucesso") => {
      const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      setToasts((t) => [...t, { id, texto, tipo }]);
      // Some sozinho: aviso de sucesso que exige clique vira lixo na tela.
      setTimeout(() => fechar(id), 4500);
    },
    [fechar],
  );

  const valor = useMemo(() => ({ notificar, fechar }), [notificar, fechar]);

  return (
    <ToastCtx.Provider value={valor}>
      {children}
      <Toasts toasts={toasts} aoFechar={fechar} />
    </ToastCtx.Provider>
  );
}

export function useToast(): Ctx {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast precisa estar dentro de <ToastProvider>");
  return ctx;
}

/**
 * Liga o retorno de uma Server Action (via `useActionState`) ao toast: toda
 * vez que o `estado` vira sucesso com `mensagem`, avisa uma vez. Poupa cada
 * formulário de escrever o mesmo `useEffect` — e evita o erro fácil de ligar
 * o efeito em `estado.mensagem` (que não muda de identidade e nunca dispara
 * de novo numa segunda tentativa idêntica).
 */
export function useToastEstado(estado: EstadoForm): void {
  const { notificar } = useToast();
  useEffect(() => {
    if (estado.ok && estado.mensagem) notificar(estado.mensagem);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);
}

/**
 * Toast de "flash": nasce de um `?param=` que um `redirect()` de Server
 * Action deixou na URL (ex.: fim do onboarding), dispara uma vez e limpa o
 * parâmetro — sem isso, um F5 repetiria o aviso para sempre.
 *
 * `history.replaceState` em vez de `router.replace`: trocar a URL não pode
 * re-executar o Server Component que acabou de trazer os dados certos.
 */
export function FlashToast({
  mensagem,
  tipo = "sucesso",
  param,
}: {
  mensagem: string;
  tipo?: Toast["tipo"];
  param: string;
}) {
  const { notificar } = useToast();

  useEffect(() => {
    notificar(mensagem, tipo);
    const url = new URL(window.location.href);
    url.searchParams.delete(param);
    window.history.replaceState({}, "", url.pathname + url.search);
    // Dispara só na montagem: `mensagem`/`tipo` não mudam depois do redirect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
