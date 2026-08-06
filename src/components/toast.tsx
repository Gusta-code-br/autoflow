"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

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
