"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Pagina } from "@/components/shell";
import { Barra, Botao, Card, CardTitulo, Vazio, cx } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { useApp } from "@/lib/store";
import {
  brl,
  dataCurta,
  dataLonga,
  diasAte,
  numero,
  prazoRelativo,
  tempoRelativo,
} from "@/lib/format";
import type { UsoDiario } from "@/lib/types";

type Pendencia = {
  id: string;
  icone: IconName;
  texto: string;
  detalhe: string;
  href: string;
};

type Atividade = {
  id: string;
  data: string;
  icone: IconName;
  tom: "marca" | "sucesso" | "info";
  texto: string;
};

export default function PainelPage() {
  const app = useApp();
  const [saudacao, setSaudacao] = useState("Olá");

  useEffect(() => {
    const h = new Date().getHours();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- saudação depende da hora do cliente; estado inicial neutro evita mismatch de hidratação
    setSaudacao(h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite");
  }, []);

  const totalNaoLidas = app.conversas.reduce((s, c) => s + c.naoLidas, 0);
  const totalEmAberto = app.cobrancas
    .filter((c) => c.status === "pendente" || c.status === "vencido" || c.status === "negociando")
    .reduce((s, c) => s + c.valor, 0);
  const agendamentosSemana = app.agendamentos.filter(
    (a) => a.status !== "cancelado" && diasAte(a.inicio) >= 0 && diasAte(a.inicio) <= 7,
  );

  const pendencias: Pendencia[] = [
    ...app.conversas
      .filter((c) => c.naoLidas > 0)
      .map((c) => ({
        id: `nl-${c.id}`,
        icone: "chat" as const,
        texto: `${c.contatoNome} — ${c.naoLidas} ${c.naoLidas === 1 ? "mensagem não lida" : "mensagens não lidas"}`,
        detalhe: tempoRelativo(c.ultimaAtividade),
        href: "/painel/atendimento",
      })),
    ...(app.tem("cobranca")
      ? app.cobrancas
          .filter((c) => c.status === "vencido" && diasAte(c.vencimento) <= -7)
          .map((c) => ({
            id: `vc-${c.id}`,
            icone: "cash" as const,
            texto: `${c.clienteNome} está vencido ${prazoRelativo(c.vencimento)}`,
            detalhe: brl(c.valor),
            href: "/painel/cobranca",
          }))
      : []),
    ...(app.tem("agendamento")
      ? app.agendamentos
          .filter((a) => a.status === "pendente")
          .map((a) => ({
            id: `ag-${a.id}`,
            icone: "calendar" as const,
            texto: `${a.clienteNome} aguarda confirmação — ${a.servico}`,
            detalhe: prazoRelativo(a.inicio),
            href: "/painel/agenda",
          }))
      : []),
  ];

  const atividades: Atividade[] = [
    ...app.conversas.map((c) => ({
      id: `conv-${c.id}`,
      data: c.ultimaAtividade,
      icone: "chat" as const,
      tom: "marca" as const,
      texto: `${c.contatoNome}: ${c.resumoIA}`,
    })),
    ...(app.tem("cobranca")
      ? app.cobrancas
          .filter((c) => c.status === "pago" && c.pagoEm)
          .map((c) => ({
            id: `cob-${c.id}`,
            data: c.pagoEm as string,
            icone: "cash" as const,
            tom: "sucesso" as const,
            texto: `${c.clienteNome} pagou ${brl(c.valor)}`,
          }))
      : []),
    ...(app.tem("agendamento")
      ? app.agendamentos
          .filter((a) => a.origem === "ia")
          .map((a) => ({
            id: `ag-${a.id}`,
            data: a.inicio,
            icone: "calendar" as const,
            tom: "info" as const,
            texto: `Agendamento com ${a.clienteNome} — ${a.servico}`,
          }))
      : []),
  ]
    .sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime())
    .slice(0, 8);

  const avgDiario = app.uso.length
    ? app.uso.reduce((s, u) => s + u.atendimento + u.cobranca + u.agendamento, 0) / app.uso.length
    : 0;
  const diasRestantes = avgDiario > 0 ? Math.floor(app.creditosRestantes / avgDiario) : null;
  // eslint-disable-next-line react-hooks/purity -- projeção de créditos usa a data atual apenas para exibição
  const agora = Date.now();
  const dataProjetada =
    diasRestantes !== null ? new Date(agora + diasRestantes * 86400000).toISOString() : null;

  return (
    <Pagina
      titulo="Visão geral"
      descricao={`${saudacao}${app.conta.nomeEmpresa ? `, ${app.conta.nomeEmpresa}` : ""}! Aqui está um resumo do que está acontecendo hoje.`}
    >
      {app.conexoes.length === 0 && (
        <Card className="mb-6 flex flex-col items-start gap-3 border-brand-200 bg-brand-50/60 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-brand-100 p-2.5 text-brand-700">
              <Icon name="plug" className="size-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-ink-900">
                Conecte seu WhatsApp para começar
              </p>
              <p className="text-[13px] text-ink-600">
                Sem um número conectado, a IA ainda não consegue atender, cobrar ou agendar
                por você.
              </p>
            </div>
          </div>
          <Link href="/painel/conexoes">
            <Botao iconeDireita="arrowRight">Conectar WhatsApp</Botao>
          </Link>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          rotulo="Conversas ativas hoje"
          valor={numero(app.conversas.length)}
          icone="chat"
          tom="marca"
        />
        <StatCard
          rotulo="Mensagens não lidas"
          valor={numero(totalNaoLidas)}
          icone="bell"
          tom={totalNaoLidas > 0 ? "aviso" : "marca"}
        />
        {app.tem("cobranca") && (
          <StatCard
            rotulo="Valor em aberto"
            valor={brl(totalEmAberto)}
            icone="cash"
            tom="perigo"
          />
        )}
        {app.tem("agendamento") && (
          <StatCard
            rotulo="Agendamentos da semana"
            valor={numero(agendamentosSemana.length)}
            icone="calendar"
            tom="info"
          />
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardTitulo
              titulo="Uso de IA nos últimos 14 dias"
              subtitulo="Mensagens consumidas por módulo, por dia"
            />
            <div className="p-5">
              <GraficoUso dias={app.uso} />
            </div>
          </Card>

          <Card>
            <CardTitulo titulo="Últimas atividades" subtitulo="Tudo que aconteceu por aqui" />
            <div className="p-5">
              {atividades.length === 0 ? (
                <Vazio
                  icone="clock"
                  titulo="Nenhuma atividade ainda"
                  descricao="Assim que sua IA começar a atender, cobrar ou agendar, tudo vai aparecer aqui."
                />
              ) : (
                <ul className="space-y-4">
                  {atividades.map((a) => (
                    <li key={a.id} className="flex items-start gap-3">
                      <span
                        className={cx(
                          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
                          a.tom === "marca" && "bg-brand-50 text-brand-600",
                          a.tom === "sucesso" && "bg-emerald-50 text-emerald-600",
                          a.tom === "info" && "bg-sky-50 text-sky-600",
                        )}
                      >
                        <Icon name={a.icone} className="size-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] leading-relaxed text-ink-700">{a.texto}</p>
                      </div>
                      <span className="shrink-0 text-xs text-ink-400">
                        {tempoRelativo(a.data)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardTitulo titulo="Créditos de IA" subtitulo="Sua cota deste mês" />
            <div className="p-5">
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium text-ink-800">
                  {numero(app.creditosRestantes)} restantes
                </span>
                <span className="text-ink-500">de {numero(app.creditosTotais)}</span>
              </div>
              <Barra
                valor={app.percentualUso}
                tom={
                  app.percentualUso > 90 ? "perigo" : app.percentualUso > 70 ? "aviso" : "marca"
                }
                className="mt-2.5"
              />
              <p className="mt-3 text-[13px] leading-relaxed text-ink-500">
                {app.creditosRestantes === 0
                  ? "Seus créditos acabaram. Recarregue para a IA continuar respondendo."
                  : dataProjetada
                    ? `No ritmo atual, seus créditos duram até ${dataLonga(dataProjetada)}.`
                    : "Ainda não há uso suficiente para projetar a duração dos créditos."}
              </p>
              <Link href="/painel/creditos" className="mt-4 block">
                <Botao variante="secundario" className="w-full" iconeDireita="arrowRight">
                  Ver plano e créditos
                </Botao>
              </Link>
            </div>
          </Card>

          <Card>
            <CardTitulo titulo="Precisa de você" subtitulo="Pendências que merecem atenção" />
            <div className="p-2">
              {pendencias.length === 0 ? (
                <Vazio icone="check" titulo="Tudo em dia!" descricao="Nenhuma pendência agora." />
              ) : (
                <ul>
                  {pendencias.map((p) => (
                    <li key={p.id}>
                      <Link
                        href={p.href}
                        className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-ink-50"
                      >
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600">
                          <Icon name={p.icone} className="size-3.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-ink-800">
                            {p.texto}
                          </p>
                          <p className="text-xs text-ink-500">{p.detalhe}</p>
                        </div>
                        <Icon name="chevronRight" className="size-4 shrink-0 text-ink-300" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>
      </div>
    </Pagina>
  );
}

function StatCard({
  rotulo,
  valor,
  icone,
  tom,
}: {
  rotulo: string;
  valor: string;
  icone: IconName;
  tom: "marca" | "sucesso" | "aviso" | "perigo" | "info";
}) {
  const cores: Record<typeof tom, string> = {
    marca: "bg-brand-50 text-brand-700",
    sucesso: "bg-emerald-50 text-emerald-600",
    aviso: "bg-amber-50 text-amber-600",
    perigo: "bg-rose-50 text-rose-600",
    info: "bg-sky-50 text-sky-600",
  };
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-ink-500">{rotulo}</p>
        <span className={cx("rounded-lg p-1.5", cores[tom])}>
          <Icon name={icone} className="size-4" />
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-ink-900">{valor}</p>
    </Card>
  );
}

function GraficoUso({ dias }: { dias: UsoDiario[] }) {
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
            ? `${dataCurta(ativo.data)} · ${numero(ativo.atendimento + ativo.cobranca + ativo.agendamento)} mensagens`
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
              key={dItem.data}
              className="flex h-full flex-1 flex-col-reverse items-stretch"
              onMouseEnter={() => setHoverIdx(idx)}
              onMouseLeave={() => setHoverIdx((v) => (v === idx ? null : v))}
              title={`${dataCurta(dItem.data)} — ${numero(total)} mensagens`}
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
          <div key={dItem.data} className="flex-1 text-center text-[10px] text-ink-400">
            {idx % 3 === 0 || idx === dias.length - 1 ? dataCurta(dItem.data) : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

function Legenda({ cor, nome }: { cor: string; nome: string }) {
  return (
    <span className="flex items-center gap-1.5 text-ink-600">
      <span className={cx("size-2.5 rounded-full ring-1 ring-inset ring-ink-900/10", cor)} />
      {nome}
    </span>
  );
}
