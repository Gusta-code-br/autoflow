import Link from "next/link";

import { Icon } from "@/components/icons";
import { Bloqueado } from "@/components/shell";
import { Avatar, Badge, Vazio } from "@/components/ui";
import { cx } from "@/lib/cx";
import { brl, corAvatar, dataCurta, telefone, tempoRelativo } from "@/lib/format";
import {
  abrirConversa,
  contagensCaixa,
  listarConversas,
  type ConversaLista,
  type IntencaoConversa,
  type ThreadConversa,
} from "@/server/dal/atendimento";
import { carregarSessaoPainel } from "@/server/dal/painel";
import { centavosParaReais } from "@/server/dominio/dinheiro";
import { horaLocalDe } from "@/server/dominio/tempo";
import { Composer, BotaoModo, MarcarLida } from "./interacoes";

/**
 * Caixa de entrada: tudo que a IA está conversando, em um lugar só.
 *
 * Server Component. O estado que era `useState` virou URL (`?aba=&q=&c=`): a
 * conversa aberta é um link, então dá para mandar "olha esse cliente" no chat
 * do time, o botão voltar funciona e a lista chega renderizada em vez de
 * aparecer depois de um fetch. O que sobra de browser são o campo de resposta,
 * o botão de assumir e o "marcar como lida" — todos em `interacoes.tsx`.
 *
 * Nada aqui recebe `orgId`: a DAL resolve org e papel pelo cookie, com RLS
 * ligado no banco.
 */

type ChaveAba = "todas" | "nao-lidas" | "cobranca" | "agendamento";

const ABAS = [
  { chave: "todas", nome: "Todas" },
  { chave: "nao-lidas", nome: "Não lidas", apenasNaoLidas: true },
  { chave: "cobranca", nome: "Cobrança", intencao: "cobranca" },
  { chave: "agendamento", nome: "Agendamento", intencao: "agendamento" },
] as const satisfies readonly {
  chave: ChaveAba;
  nome: string;
  apenasNaoLidas?: boolean;
  intencao?: IntencaoConversa;
}[];

const NOME_INTENCAO: Record<IntencaoConversa, string> = {
  cobranca: "Cobrança",
  agendamento: "Agendamento",
  duvida: "Dúvida",
  suporte: "Suporte",
  outro: "Outro",
};

const TOM_INTENCAO: Record<
  IntencaoConversa,
  "aviso" | "info" | "neutro" | "marca"
> = {
  cobranca: "aviso",
  agendamento: "info",
  duvida: "neutro",
  suporte: "marca",
  outro: "neutro",
};

export default async function AtendimentoPage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string; q?: string; c?: string }>;
}) {
  const sessao = await carregarSessaoPainel();
  if (!sessao.plano.features.includes("atendimento")) {
    return <Bloqueado feature="atendimento" />;
  }

  const params = await searchParams;
  const busca = params.q?.trim() ?? "";
  const aba = ABAS.find((a) => a.chave === params.aba) ?? ABAS[0];

  const [contagens, conversas] = await Promise.all([
    contagensCaixa(),
    listarConversas({
      busca,
      apenasNaoLidas: "apenasNaoLidas" in aba ? aba.apenasNaoLidas : undefined,
      intencao: "intencao" in aba ? aba.intencao : undefined,
    }),
  ]);

  /*
   * No desktop as duas colunas aparecem juntas, então abrir a primeira conversa
   * evita a tela pela metade no primeiro acesso. No celular só há espaço para
   * uma coluna: sem `?c=` na URL, quem manda é a lista — por isso o padrão só
   * vale para o conteúdo, e o "estou na thread" continua sendo o parâmetro.
   */
  const conversaId = params.c ?? conversas[0]?.id;
  const thread = conversaId ? await abrirConversa(conversaId) : null;

  const href = (mudanca: { c?: string | null }) => {
    const q = new URLSearchParams();
    if (aba.chave !== "todas") q.set("aba", aba.chave);
    if (busca) q.set("q", busca);
    const c = "c" in mudanca ? mudanca.c : params.c;
    if (c) q.set("c", c);
    const s = q.toString();
    return s ? `/painel/atendimento?${s}` : "/painel/atendimento";
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] min-h-0 flex-col lg:flex-row">
      {/* Coluna esquerda — lista */}
      <div
        className={cx(
          "flex min-h-0 w-full shrink-0 flex-col border-ink-200 bg-white lg:flex lg:w-[360px] lg:border-r",
          params.c ? "hidden lg:flex" : "flex",
        )}
      >
        <div className="space-y-3 border-b border-ink-100 px-4 py-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-ink-900">
              Atendimento
            </h1>
            <p className="text-[13px] text-ink-500">
              Tudo que a IA está conversando, em um lugar só.
            </p>
          </div>
          {/*
            Busca como `method="get"`: um form de verdade, que funciona antes do
            JS carregar e deixa a URL compartilhável. A aba viaja junto num
            hidden para o filtro não se perder ao buscar.
          */}
          <form method="get" className="relative">
            {aba.chave !== "todas" && (
              <input type="hidden" name="aba" value={aba.chave} />
            )}
            <Icon
              name="search"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400"
            />
            <input
              name="q"
              defaultValue={busca}
              placeholder="Buscar conversa…"
              aria-label="Buscar conversa"
              className="w-full rounded-xl border border-ink-200 bg-white py-2 pl-9 pr-3 text-sm text-ink-900 transition-colors placeholder:text-ink-400 focus:border-brand-500 focus:outline-none"
            />
          </form>
        </div>

        <div className="px-3 pt-3">
          <nav className="flex gap-1 overflow-x-auto rounded-xl bg-ink-100 p-1">
            {ABAS.map((a) => {
              const q = new URLSearchParams();
              if (a.chave !== "todas") q.set("aba", a.chave);
              if (busca) q.set("q", busca);
              const s = q.toString();
              const ativa = a.chave === aba.chave;
              return (
                <Link
                  key={a.chave}
                  href={s ? `/painel/atendimento?${s}` : "/painel/atendimento"}
                  className={cx(
                    "flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium transition-all",
                    ativa
                      ? "bg-white text-ink-900 shadow-sm"
                      : "text-ink-500 hover:text-ink-800",
                  )}
                >
                  {a.nome}
                  <span
                    className={cx(
                      "rounded-full px-1.5 text-[10.5px]",
                      ativa
                        ? "bg-brand-100 text-brand-700"
                        : "bg-ink-200 text-ink-600",
                    )}
                  >
                    {a.chave === "nao-lidas"
                      ? contagens.naoLidas
                      : a.chave === "cobranca"
                        ? contagens.cobranca
                        : a.chave === "agendamento"
                          ? contagens.agendamento
                          : contagens.todas}
                  </span>
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="scrollbar-thin flex-1 overflow-y-auto">
          {conversas.length === 0 ? (
            <Vazio
              icone="chat"
              titulo="Nenhuma conversa encontrada"
              descricao={
                busca
                  ? "Tente outro termo de busca ou outro filtro."
                  : "Quando um cliente chamar no WhatsApp, a conversa aparece aqui."
              }
            />
          ) : (
            <ul>
              {conversas.map((c) => (
                <li key={c.id}>
                  <ItemLista
                    conversa={c}
                    ativa={c.id === thread?.conversa.id}
                    href={href({ c: c.id })}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Coluna direita — conversa */}
      <div
        className={cx(
          "flex min-h-0 flex-1 flex-col",
          params.c ? "flex" : "hidden lg:flex",
        )}
      >
        {!thread ? (
          <div className="flex flex-1 items-center justify-center bg-ink-50/50">
            <Vazio
              icone="chat"
              titulo="Selecione uma conversa"
              descricao="Escolha um contato à esquerda para ver o histórico e o resumo que a IA preparou."
            />
          </div>
        ) : (
          <Thread
            thread={thread}
            fuso={sessao.org.fuso}
            hrefVoltar={href({ c: null })}
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Lista */

function ItemLista({
  conversa: c,
  ativa,
  href,
}: {
  conversa: ConversaLista;
  ativa: boolean;
  href: string;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      className={cx(
        "flex w-full items-start gap-3 border-b border-ink-100 px-4 py-3 text-left transition-colors hover:bg-ink-50",
        ativa && "bg-brand-50/70",
      )}
    >
      <Avatar nome={c.contatoNome} cor={corAvatar(c.contatoNome)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-[13.5px] font-medium text-ink-900">
            {c.contatoNome}
          </p>
          <span className="shrink-0 text-[11px] text-ink-400">
            {tempoRelativo(c.ultimaAtividadeEm.toISOString())}
          </span>
        </div>
        <p className="mt-0.5 truncate text-[13px] text-ink-500">
          {c.previa?.replace(/\n/g, " ") ?? ""}
        </p>
        <div className="mt-1.5 flex items-center gap-1.5">
          <Badge tom={TOM_INTENCAO[c.intencao]}>{NOME_INTENCAO[c.intencao]}</Badge>
          <Badge tom={c.modo === "ia" ? "marca" : "neutro"}>
            {c.modo === "ia" ? "IA" : c.atribuidoNome?.split(" ")[0] || "Humano"}
          </Badge>
          {c.naoLidas > 0 && (
            <span className="ml-auto flex size-2 shrink-0 rounded-full bg-zap" />
          )}
        </div>
      </div>
    </Link>
  );
}

/* ----------------------------------------------------------------- Thread */

function Thread({
  thread,
  fuso,
  hrefVoltar,
}: {
  thread: ThreadConversa;
  fuso: string;
  hrefVoltar: string;
}) {
  const { conversa, mensagens, contato } = thread;

  return (
    <>
      {/* Zera o badge de não lidas sem re-renderizar a tela por baixo. */}
      <MarcarLida conversaId={conversa.id} naoLidas={conversa.naoLidas} />

      {/* Cabeçalho */}
      <div className="flex items-center gap-3 border-b border-ink-200 bg-white px-4 py-3">
        <Link
          href={hrefVoltar}
          aria-label="Voltar"
          className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 lg:hidden"
        >
          <Icon name="chevronLeft" className="size-5" />
        </Link>
        <Avatar nome={contato.nome} cor={corAvatar(contato.nome)} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-ink-900">
            {contato.nome}
          </p>
          <p className="truncate text-xs text-ink-500">
            {telefone(contato.telefone)}
            {conversa.atribuidoNome && conversa.modo === "humano" && (
              <> · com {conversa.atribuidoNome}</>
            )}
          </p>
        </div>
        <BotaoModo conversaId={conversa.id} modo={conversa.modo} />
      </div>

      {/* Resumo da IA */}
      {(conversa.resumoIa || contato.tags.length > 0) && (
        <div className="border-b border-ink-200 bg-brand-50/60 px-4 py-3">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 rounded-lg bg-brand-100 p-1.5 text-brand-700">
              <Icon name="spark" className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-brand-700">
                Resumo da IA
              </p>
              <p className="mt-0.5 text-[13.5px] leading-relaxed text-ink-700">
                {conversa.resumoIa ?? "Ainda sem resumo para esta conversa."}
              </p>
              {contato.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {contato.tags.map((t) => (
                    <Badge key={t} tom="marca">
                      {t}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Contexto do cliente: o que o atendente precisa sem trocar de tela */}
      {(thread.cobrancasAbertas.length > 0 ||
        thread.proximosAgendamentos.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-200 bg-white px-4 py-2">
          {thread.cobrancasAbertas.map((c) => (
            <Link
              key={c.id}
              href="/painel/cobranca"
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2 py-1 text-[12px] text-amber-700 hover:bg-amber-100"
            >
              <Icon name="cash" className="size-3.5" />
              {c.descricao} · {brl(centavosParaReais(Number(c.valor)))} · vence{" "}
              {dataCurta(c.venceEm)}
            </Link>
          ))}
          {thread.proximosAgendamentos.map((a) => (
            <Link
              key={a.id}
              href="/painel/agenda"
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-50 px-2 py-1 text-[12px] text-sky-700 hover:bg-sky-100"
            >
              <Icon name="calendar" className="size-3.5" />
              {a.servico ?? "Agendamento"} · {horaLocalDe(a.inicio, fuso)}
            </Link>
          ))}
        </div>
      )}

      {/* Mensagens */}
      <div className="chat-bg scrollbar-thin flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto flex max-w-xl flex-col gap-2.5">
          {mensagens.map((m) => {
            if (m.autor === "sistema") {
              return (
                <div key={m.id} className="flex justify-center">
                  <span className="rounded-full bg-ink-900/8 px-3 py-1 text-[11.5px] text-ink-600">
                    {m.texto}
                  </span>
                </div>
              );
            }
            const daEmpresa = m.direcao === "saida";
            return (
              <div
                key={m.id}
                className={cx("flex", daEmpresa ? "justify-end" : "justify-start")}
              >
                <div
                  className={cx(
                    "max-w-[80%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed shadow-sm",
                    daEmpresa
                      ? "rounded-tr-sm bg-[#d9fdd3] text-ink-900"
                      : "rounded-tl-sm bg-white text-ink-900",
                    m.status === "falhou" && "ring-1 ring-rose-300 ring-inset",
                  )}
                >
                  {daEmpresa && (
                    <span
                      className={cx(
                        "mb-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                        m.autor === "ia"
                          ? "bg-brand-100 text-brand-700"
                          : "bg-emerald-100 text-emerald-700",
                      )}
                    >
                      {m.autor === "ia" ? "IA" : (m.autorNome ?? "Você")}
                    </span>
                  )}
                  <p className="whitespace-pre-line">{m.texto}</p>
                  <p className="mt-1 flex items-center justify-end gap-1 text-right text-[10.5px] text-ink-400">
                    {/* Hora no fuso da empresa: o container roda em UTC. */}
                    {horaLocalDe(m.criadoEm, fuso)}
                    {m.status === "pendente" && <Icon name="clock" className="size-3" />}
                    {m.status === "falhou" && (
                      <span className="text-rose-600">falhou</span>
                    )}
                  </p>
                  {m.erro && (
                    <p className="mt-1 text-[11px] text-rose-600">{m.erro}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Envio */}
      <Composer
        conversaId={conversa.id}
        modo={conversa.modo}
        janelaAberta={conversa.janelaAberta}
        optOut={contato.optOut}
      />
    </>
  );
}
