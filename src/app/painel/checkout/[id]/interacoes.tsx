"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Icon } from "@/components/icons";
import { Botao } from "@/components/ui";
import { cx } from "@/lib/cx";

/**
 * As duas partes do checkout que precisam de browser: copiar o código PIX e
 * esperar o webhook.
 *
 * Ninguém "confirma" pagamento por aqui — quem muda o status é o webhook do
 * provedor. O cliente só olha. Por isso a espera é um `router.refresh()` em
 * intervalo, que refaz o Server Component e traz o status novo do banco.
 */

export function CodigoPix({ codigo }: { codigo: string }) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* Sem permissão de clipboard: o código continua visível e selecionável. */
    }
  }

  return (
    <div className="space-y-2">
      <p className="rounded-xl border border-ink-200 bg-ink-50 p-3 font-mono text-[11px] leading-relaxed break-all text-ink-700">
        {codigo}
      </p>
      <Botao
        variante="secundario"
        className="w-full"
        icone={copiado ? "check" : "copy"}
        onClick={copiar}
      >
        {copiado ? "Código copiado" : "Copiar código PIX"}
      </Botao>
    </div>
  );
}

/**
 * Contagem regressiva + polling enquanto o pagamento está pendente.
 *
 * O relógio começa `null` e só ganha valor dentro do efeito: renderizar o
 * tempo restante no servidor daria mismatch de hidratação todo request, porque
 * o "agora" do servidor nunca é o "agora" do browser.
 */
export function Aguardando({ expiraEm }: { expiraEm: string | null }) {
  const router = useRouter();
  const [restante, setRestante] = useState<number | null>(null);

  useEffect(() => {
    if (!expiraEm) return;
    const alvo = new Date(expiraEm).getTime();
    const tick = () =>
      setRestante(Math.max(0, Math.floor((alvo - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiraEm]);

  useEffect(() => {
    /*
     * 5s é o compromisso: rápido o bastante para o PIX parecer instantâneo,
     * lento o bastante para não virar carga inútil no banco de quem deixou a
     * aba aberta. O intervalo morre junto com a tela.
     */
    const id = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(id);
  }, [router]);

  const expirado = restante !== null && restante <= 0;
  const mm = restante === null ? null : Math.floor(restante / 60);
  const ss = restante === null ? null : restante % 60;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="inline-flex items-center gap-2 text-[13px] text-ink-500">
        <Icon name="clock" className="size-4 shrink-0 animate-pulse" />
        {expirado
          ? "Este código expirou. Gere um novo pagamento."
          : "Aguardando a confirmação do banco…"}
      </span>
      {mm !== null && ss !== null && !expirado && (
        <span
          className={cx(
            "font-mono text-[13px] tabular-nums",
            mm < 5 ? "text-amber-700" : "text-ink-500",
          )}
        >
          expira em {String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}
        </span>
      )}
    </div>
  );
}
