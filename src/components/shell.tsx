"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { sairAction } from "@/server/actions/auth";
import { planoMinimoPara } from "@/lib/plans";
import type { FeatureKey } from "@/lib/types";
import type { SessaoPainel } from "@/server/dal/painel";
import { Icon, Logo, type IconName } from "./icons";
import { Badge, Botao } from "./ui";
import { cx } from "@/lib/cx";

/**
 * Casco do painel.
 *
 * Client component, mas sem estado de negócio: tudo o que ele desenha vem do
 * `sessao` que o layout (server) carregou. O `useState` aqui só abre e fecha
 * menu. Isso é o que faz o painel refletir o banco — antes ele lia de um store
 * de localStorage e por isso continuava mostrando a demo depois do login.
 */

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

export function Shell({
  sessao,
  children,
}: {
  sessao: SessaoPainel;
  children: ReactNode;
}) {
  const [menuAberto, setMenuAberto] = useState(false);

  return (
    <div className="flex min-h-screen bg-ink-50">
      {menuAberto && (
        <div
          className="fixed inset-0 z-30 bg-ink-950/40 lg:hidden"
          onClick={() => setMenuAberto(false)}
        />
      )}

      <Sidebar
        sessao={sessao}
        aberto={menuAberto}
        aoNavegar={() => setMenuAberto(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <Topbar sessao={sessao} aoAbrirMenu={() => setMenuAberto(true)} />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}

function Sidebar({
  sessao,
  aberto,
  aoNavegar,
}: {
  sessao: SessaoPainel;
  aberto: boolean;
  aoNavegar: () => void;
}) {
  const pathname = usePathname();
  const { plano } = sessao;

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
                  ? !plano.features.includes(item.feature)
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
                        sessao.naoLidas > 0 && (
                          <span className="size-2 rounded-full bg-zap" />
                        )}
                      {item.href === "/painel/conexoes" &&
                        sessao.conexoes.comProblema > 0 && (
                          <span className="size-2 rounded-full bg-rose-500" />
                        )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

    </aside>
  );
}

function Topbar({
  sessao,
  aoAbrirMenu,
}: {
  sessao: SessaoPainel;
  aoAbrirMenu: () => void;
}) {
  const { conexoes, org } = sessao;

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
        <p className="truncate text-sm font-semibold text-ink-900">{org.nome}</p>
        <p className="truncate text-xs text-ink-500">
          {conexoes.conectadas} WhatsApp conectado
          {conexoes.conectadas === 1 ? "" : "s"} · IA {org.nomeAtendente}
        </p>
      </div>

      {conexoes.conectadas === 0 && (
        <Link href="/painel/conexoes" className="hidden sm:block">
          <Botao tamanho="sm" icone="plug">
            Conectar WhatsApp
          </Botao>
        </Link>
      )}

      <MenuUsuario sessao={sessao} />
    </header>
  );
}

function MenuUsuario({ sessao }: { sessao: SessaoPainel }) {
  const [aberto, setAberto] = useState(false);
  const iniciais = (sessao.usuario.nome || sessao.org.nome || "AF")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="relative">
      <button
        onClick={() => setAberto((v) => !v)}
        className="flex size-9 items-center justify-center rounded-full bg-brand-100 text-[13px] font-semibold text-brand-700 hover:bg-brand-200"
        aria-label="Menu do usuário"
      >
        {iniciais}
      </button>
      {aberto && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setAberto(false)} />
          <div className="absolute right-0 top-11 z-20 w-60 rounded-xl border border-ink-200 bg-white p-1.5 shadow-lg">
            <div className="px-2.5 py-2">
              <p className="truncate text-sm font-medium text-ink-900">
                {sessao.usuario.nome}
              </p>
              <p className="truncate text-xs text-ink-500">
                {sessao.usuario.email}
              </p>
              <Badge tom="neutro" className="mt-1.5">
                {sessao.usuario.papel}
              </Badge>
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
              {sessao.verFinanceiro && (
                <Link
                  href="/painel/creditos"
                  onClick={() => setAberto(false)}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink-600 hover:bg-ink-50"
                >
                  <Icon name="card" className="size-4 text-ink-400" />
                  Plano e faturas
                </Link>
              )}
              {/*
                Sair é um POST via Server Action, não um onClick que limpa
                estado: a sessão mora no banco e no cookie httpOnly, então
                encerrar de verdade só acontece no servidor.
              */}
              <form action={sairAction}>
                <button
                  type="submit"
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink-600 hover:bg-ink-50"
                >
                  <Icon name="logout" className="size-4 text-ink-400" />
                  Sair
                </button>
              </form>
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
          {descricao && <p className="mt-1 text-sm text-ink-500">{descricao}</p>}
        </div>
        {acao}
      </div>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ Paywall */

/**
 * Tela de módulo bloqueado. Quem decide se está bloqueado é a página no
 * servidor, comparando `plano.features` — o client nunca recebe dado do módulo
 * trancado, só este convite. Aqui embaixo é só a vitrine.
 */
export function Bloqueado({ feature }: { feature: FeatureKey }) {
  const necessario = planoMinimoPara(feature);
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
            <li
              key={b}
              className="flex items-start gap-2 text-[13px] text-ink-600"
            >
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
        <Link href={`/painel/creditos?plano=${necessario.id}`}>
          <Botao tamanho="lg" iconeDireita="arrowRight">
            Fazer upgrade agora
          </Botao>
        </Link>
        <Link href="/painel/creditos">
          <Botao variante="secundario" tamanho="lg">
            Comparar planos
          </Botao>
        </Link>
      </div>
      <p className="mt-3 text-xs text-ink-400">
        Você só paga a diferença proporcional ao que falta do ciclo atual.
      </p>
    </div>
  );
}
