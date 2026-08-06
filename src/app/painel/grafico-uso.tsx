"use client";

import { useState } from "react";

import { Vazio } from "@/components/ui";
import { cx } from "@/lib/cx";
import { dataCurta, numero } from "@/lib/format";
import type { DiaDeUso } from "@/server/dal/painel";

/**
 * Barras empilhadas de consumo por dia.
 *
 * Único pedaço client da visão geral: existe por causa do hover. Os números já
 * chegam prontos do servidor — nada é calculado a partir de estado local.
 */
export function GraficoUso({ dias }: { dias: DiaDeUso[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const alturaMax = 160;
  const maxTotal = Math.max(
    1,
    ...dias.map((d) => d.atendimento + d.cobranca + d.agendamento),
  );
  const ativo = hoverIdx !== null ? dias[hoverIdx] : null;

  if (dias.length === 0) {
    return (
      <Vazio
        icone="chart"
        titulo="Sem dados de uso ainda"
        descricao="O gráfico aparece assim que a IA começar a trabalhar."
      />
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-[13px]">
        <div className="flex items-center gap-4">
          <Legenda cor="bg-brand-500" nome="Atendimento" />
          <Legenda cor="bg-amber-400" nome="Cobrança" />
          <Legenda cor="bg-sky-400" nome="Agendamento" />
        </div>
        <span className="font-medium text-ink-600">
          {ativo
            ? `${dataCurta(ativo.dia)} · ${numero(ativo.atendimento + ativo.cobranca + ativo.agendamento)} mensagens`
            : `Últimos ${dias.length} dias`}
        </span>
      </div>

      <div className="flex items-end gap-1.5" style={{ height: alturaMax }}>
        {dias.map((dItem, idx) => {
          const total = dItem.atendimento + dItem.cobranca + dItem.agendamento;
          const hAtend = Math.round((dItem.atendimento / maxTotal) * alturaMax);
          const hCob = Math.round((dItem.cobranca / maxTotal) * alturaMax);
          const hAgen = Math.round((dItem.agendamento / maxTotal) * alturaMax);
          return (
            <div
              key={dItem.dia}
              className="flex h-full flex-1 flex-col-reverse items-stretch"
              onMouseEnter={() => setHoverIdx(idx)}
              onMouseLeave={() => setHoverIdx((v) => (v === idx ? null : v))}
              title={`${dataCurta(dItem.dia)} — ${numero(total)} mensagens`}
            >
              <div
                className={cx(
                  "w-full bg-brand-500 transition-opacity",
                  hoverIdx !== null && hoverIdx !== idx && "opacity-40",
                )}
                style={{ height: hAtend }}
              />
              <div
                className={cx(
                  "w-full bg-amber-400 transition-opacity",
                  hoverIdx !== null && hoverIdx !== idx && "opacity-40",
                )}
                style={{ height: hCob }}
              />
              <div
                className={cx(
                  "w-full rounded-t-sm bg-sky-400 transition-opacity",
                  hoverIdx !== null && hoverIdx !== idx && "opacity-40",
                )}
                style={{ height: hAgen }}
              />
            </div>
          );
        })}
      </div>

      <div className="mt-1.5 flex gap-1.5">
        {dias.map((dItem, idx) => (
          <div
            key={dItem.dia}
            className="flex-1 text-center text-[10px] text-ink-400"
          >
            {idx % 3 === 0 || idx === dias.length - 1 ? dataCurta(dItem.dia) : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

function Legenda({ cor, nome }: { cor: string; nome: string }) {
  return (
    <span className="flex items-center gap-1.5 text-ink-600">
      <span
        className={cx(
          "size-2.5 rounded-full ring-1 ring-inset ring-ink-900/10",
          cor,
        )}
      />
      {nome}
    </span>
  );
}
