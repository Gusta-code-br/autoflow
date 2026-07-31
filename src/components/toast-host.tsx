"use client";

import { useApp } from "@/lib/store";
import { Toasts } from "./ui";

export function ToastHost() {
  const { toasts, fecharToast } = useApp();
  return <Toasts toasts={toasts} aoFechar={fecharToast} />;
}
