"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useApp } from "@/lib/store";
import { PLANOS, getPlano } from "@/lib/plans";
import { numero } from "@/lib/format";
import type { FeatureKey, PlanId } from "@/lib/types";
import { Icon, Logo, type IconName } from "./icons";
import { Badge, Barra, Botao, cx } from "./ui";

interface ItemNav {
  href: string;
  nome: string;
  icone: IconName;
  feature?: FeatureKey;
}

const NAV: { grupo: string; itens: ItemNav[] }[] = [
  {
    grupo: "Operação",
    itens: [
      { href: "/painel", nome: "Visão geral", icone: "home" },
      {
        href: "/painel/atendimento",
        nome: "Atendimento",
        icone: "chat",
        feature: "atendimento",
      },
      {
        href: "/painel/cobranca",
        nome: "Cobrança",
        icone: "cash",
        feature: "cobranca",
      },
      {
        href: "/painel/agenda",
        nome: "Agenda",
        icone: "calendar",
        feature: "agendamento",
      },
    ],
  },
  {
    grupo: "Configuração",
    itens: [
      { href: "/painel/conexoes", nome: "WhatsApp", icone: "plug" },
      { href: "/painel/creditos", nome: "Plano e créditos", icone: "card" },
      { href: "/painel/config", nome: "Ajustes da IA", icone: "gear" },
    ],
  },
];

export function Shell({ children }: { children: ReactNode }) {
  const app = useApp();
  const router = useRouter();
  const [menuAberto, setMenuAberto] = useState(false);

  useEffect(() => {
    if (app.pronto && !app.logado) router.replace("/entrar");
  }, [app.pronto, app.logado, router]);

  if (!app.pronto || !app.logado) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-3 text-ink-400">
          <Logo className="size-8 animate-pulse" />
          <span className="text-sm">Carregando…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-ink-50">
      {menuAberto && (
        <div
          className="fixed inset-0 z-30 bg-ink-950/40 lg:hidden"
          onClick={() => setMenuAberto(false)}
        />
      )}

      <Sidebar aberto={menuAberto} aoNavegar={() => setMenuAberto(false)} />

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <Topbar aoAbrirMenu={() => setMenuAberto(true)} />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}

function Sidebar({
  aberto,
  aoNavegar,
}: {
  aberto: boolean;
  aoNavegar: () => void;
}) {
  const app = useApp();
  const pathname = usePathname();
  const plano = getPlano(app.conta.planoId);

  return (
    <aside
      className={cx(
        "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-ink-200 bg-white transition-transform lg:translate-x-0",
        aberto ? "translate-x-0" : "-translate-x-full",
      )}
    >
      <div className="flex h-16 items-center gap-2.5 border-b border-ink-100 px-5">
        <Logo className="size-8" />
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold tracking-tight text-ink-900">
            AutoFlow
          </p>
        </div>
        <Badge tom="marca" className="ml-auto">
          {plano.nome}
        </Badge>
      </div>

      <nav className="scrollbar-thin flex-1 space-y-6 overflow-y-auto px-3 py-5">
        {NAV.map((g) => (
          <div key={g.grupo}>
            <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
              {g.grupo}
            </p>
            <ul className="space-y-0.5">
              {g.itens.map((item) => {
                const ativo =
                  item.href === "/painel"
                    ? pathname === "/painel"
                    : pathname.startsWith(item.href);
                const bloqueado = item.feature
                  ? !app.tem(item.feature)
                  : false;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={aoNavegar}
                      className={cx(
                        "group flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors",
                        ativo
                          ? "bg-brand-50 font-medium text-brand-800"
                          : "text-ink-600 hover:bg-ink-50 hover:text-ink-900",
                      )}
                    >
                      <Icon
                        name={item.icone}
                        className={cx(
                          "size-[18px] shrink-0",
                          ativo ? "text-brand-600" : "text-ink-400",
                        )}
                      />
                      <span className="flex-1">{item.nome}</span>
                      {bloqueado && (
                        <Icon name="lock" className="size-3.5 text-ink-300" />
                      )}
                      {item.href === "/painel/atendimento" &&
                        app.conversas.some((c) => c.naoLidas > 0) && (
                          <span className="size-2 rounded-full bg-zap" />
                        )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-ink-100 p-3">
        <Link
          href="/painel/creditos"
          className="block rounded-xl bg-ink-50 p-3.5 transition-colors hover:bg-ink-100"
        >
          <div className="flex items-center justify-between text-[13px]">
            <span className="font-medium text-ink-700">Créditos de IA</span>
            <span className="text-ink-500">{app.percentualUso}%</span>
          </div>
          <Barra
            valor={app.percentualUso}
            tom={
              app.percentualUso > 90
                ? "perigo"
                : app.percentualUso > 70
                  ? "aviso"
                  : "marca"
            }
            className="mt-2"
          />
          <p className="mt-2 text-xs text-ink-500">
            {numero(app.creditosRestantes)} de {numero(app.creditosTotais)}{" "}
            mensagens
          </p>
          {app.percentualUso > 70 && (
            <p className="mt-1.5 text-xs font-medium text-brand-700">
              Recarregar créditos →
            </p>
          )}
        </Link>
      </div>
    </aside>
  );
}

function Topbar({ aoAbrirMenu }: { aoAbrirMenu: () => void }) {
  const app = useApp();
  const [abrirDemo, setAbrirDemo] = useState(false);

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-ink-200 bg-white/85 px-4 backdrop-blur-md lg:px-8">
      <button
        onClick={aoAbrirMenu}
        aria-label="Abrir menu"
        className="rounded-lg p-2 text-ink-500 hover:bg-ink-100 lg:hidden"
      >
        <Icon name="menu" className="size-5" />
      </button>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink-900">
          {app.conta.nomeEmpresa || "Sua empresa"}
        </p>
        <p className="truncate text-xs text-ink-500">
          {app.conexoes.filter((c) => c.status === "conectado").length} WhatsApp
          conectado
          {app.conexoes.filter((c) => c.status === "conectado").length === 1
            ? ""
            : "s"}{" "}
          · IA {app.conta.nomeAtendente || "sem nome"}
        </p>
      </div>

      {/* Seletor de plano — só existe no protótipo, pra demonstrar o gating */}
      <div className="relative">
        <button
          onClick={() => setAbrirDemo((v) => !v)}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-brand-300 bg-brand-50/60 px-2.5 text-[12px] font-medium text-brand-700 hover:bg-brand-50"
        >
          <Icon name="eye" className="size-3.5" />
          <span className="hidden sm:inline">Ver como</span>
          {getPlano(app.conta.planoId).nome}
          <Icon name="chevronDown" className="size-3" />
        </button>
        {abrirDemo && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setAbrirDemo(false)}
            />
            <div className="absolute right-0 top-11 z-20 w-64 rounded-xl border border-ink-200 bg-white p-1.5 shadow-lg">
              <p className="px-2.5 py-2 text-[11px] leading-snug text-ink-500">
                Modo demonstração: troque o plano pra ver o que cada um libera.
              </p>
              {PLANOS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    app.atualizarConta({ planoId: p.id as PlanId });
                    setAbrirDemo(false);
                    app.notificar(`Visualizando como plano ${p.nome}.`, "info");
                  }}
                  className={cx(
                    "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors",
                    app.conta.planoId === p.id
                      ? "bg-brand-50 font-medium text-brand-800"
                      : "text-ink-600 hover:bg-ink-50",
                  )}
                >
                  <span className="flex-1">{p.nome}</span>
                  <span className="text-[11px] text-ink-400">
                    {p.features.length} módulo
                    {p.features.length > 1 ? "s" : ""}
                  </span>
                </button>
              ))}
              <div className="mt-1 border-t border-ink-100 pt-1">
                <button
                  onClick={() => {
                    app.resetarDemo();
                    setAbrirDemo(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink-500 hover:bg-ink-50"
                >
                  <Icon name="refresh" className="size-3.5" />
                  Reiniciar dados do protótipo
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <MenuUsuario />
    </header>
  );
}

function MenuUsuario() {
  const app = useApp();
  const router = useRouter();
  const [aberto, setAberto] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setAberto((v) => !v)}
        className="flex size-9 items-center justify-center rounded-full bg-brand-100 text-[13px] font-semibold text-brand-700 hover:bg-brand-200"
        aria-label="Menu do usuário"
      >
        {(app.conta.nomeEmpresa || "AF").slice(0, 2).toUpperCase()}
      </button>
      {aberto && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setAberto(false)} />
          <div className="absolute right-0 top-11 z-20 w-60 rounded-xl border border-ink-200 bg-white p-1.5 shadow-lg">
            <div className="px-2.5 py-2">
              <p className="truncate text-sm font-medium text-ink-900">
                {app.conta.nomeEmpresa || "Sua empresa"}
              </p>
              <p className="truncate text-xs text-ink-500">
                {app.conta.email || "—"}
              </p>
            </div>
            <div className="border-t border-ink-100 pt-1">
              <Link
                href="/painel/config"
                onClick={() => setAberto(false)}
                className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink-600 hover:bg-ink-50"
              >
                <Icon name="gear" className="size-4 text-ink-400" />
                Ajustes
              </Link>
              <Link
                href="/painel/creditos"
                onClick={() => setAberto(false)}
                className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink-600 hover:bg-ink-50"
              >
                <Icon name="card" className="size-4 text-ink-400" />
                Plano e faturas
              </Link>
              <button
                onClick={() => {
                  app.sair();
                  router.push("/");
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink-600 hover:bg-ink-50"
              >
                <Icon name="logout" className="size-4 text-ink-400" />
                Sair
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------- Cabeçalho de página */

export function Pagina({
  titulo,
  descricao,
  acao,
  children,
}: {
  titulo: string;
  descricao?: string;
  acao?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-900 lg:text-2xl">
            {titulo}
          </h1>
          {descricao && (
            <p className="mt-1 text-sm text-ink-500">{descricao}</p>
          )}
        </div>
        {acao}
      </div>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------- Paywall */

export function Bloqueado({ feature }: { feature: FeatureKey }) {
  const app = useApp();
  const necessario = PLANOS.find((p) => p.features.includes(feature))!;
  const nomes: Record<FeatureKey, string> = {
    atendimento: "Atendimento com IA",
    cobranca: "Cobrança automática",
    agendamento: "Agendamento pela IA",
  };
  const descricoes: Record<FeatureKey, string> = {
    atendimento:
      "Deixe a IA responder seus clientes no WhatsApp 24 horas por dia, com o nome e o tom de voz da sua atendente.",
    cobranca:
      "Monte réguas que lembram antes do vencimento, cobram no dia e insistem depois — com PIX dentro da mensagem, sem você tocar em nada.",
    agendamento:
      "A IA marca o horário direto na conversa, joga na sua agenda e te avisa no seu WhatsApp pessoal a cada novo agendamento.",
  };

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-16 text-center lg:py-24">
      <span className="rounded-2xl bg-brand-50 p-3.5 text-brand-600">
        <Icon name="lock" className="size-7" />
      </span>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-ink-900">
        {nomes[feature]}
      </h1>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-500">
        {descricoes[feature]}
      </p>
      <div className="mt-6 w-full rounded-2xl border border-brand-200 bg-brand-50/50 p-5 text-left">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] text-ink-500">Disponível a partir do</p>
            <p className="text-lg font-semibold text-ink-900">
              Plano {necessario.nome}
            </p>
          </div>
          <p className="text-right">
            <span className="text-2xl font-semibold text-ink-900">
              R$ {necessario.precoMensal}
            </span>
            <span className="text-sm text-ink-500">/mês</span>
          </p>
        </div>
        <ul className="mt-4 space-y-1.5">
          {necessario.beneficios.slice(0, 4).map((b) => (
            <li key={b} className="flex items-start gap-2 text-[13px] text-ink-600">
              <Icon
                name="check"
                className="mt-0.5 size-3.5 shrink-0 text-brand-600"
              />
              {b}
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <Botao
          tamanho="lg"
          onClick={() => {
            app.assinar(necessario.id, app.conta.periodo);
            app.notificar(`Plano ${necessario.nome} ativado.`);
          }}
          iconeDireita="arrowRight"
        >
          Fazer upgrade agora
        </Botao>
        <Link href="/painel/creditos">
          <Botao variante="secundario" tamanho="lg">
            Comparar planos
          </Botao>
        </Link>
      </div>
      <p className="mt-3 text-xs text-ink-400">
        No protótipo o upgrade é instantâneo e sem cobrança.
      </p>
    </div>
  );
}
