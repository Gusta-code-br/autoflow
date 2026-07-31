"use client";

import { useMemo, useState } from "react";
import { Bloqueado } from "@/components/shell";
import {
  Avatar,
  Badge,
  Botao,
  Input,
  Vazio,
  cx,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import { useApp } from "@/lib/store";
import { corAvatar, hora, telefone, tempoRelativo } from "@/lib/format";
import type { Conversa, Intencao } from "@/lib/types";

type FiltroAba = "todas" | "nao-lidas" | "cobranca" | "agendamento";

const NOME_INTENCAO: Record<Intencao, string> = {
  cobranca: "Cobrança",
  agendamento: "Agendamento",
  duvida: "Dúvida",
  suporte: "Suporte",
};

const TOM_INTENCAO: Record<Intencao, "aviso" | "info" | "neutro" | "marca"> = {
  cobranca: "aviso",
  agendamento: "info",
  duvida: "neutro",
  suporte: "marca",
};

function AtendimentoConteudo() {
  const app = useApp();
  const [busca, setBusca] = useState("");
  const [aba, setAba] = useState<FiltroAba>("todas");
  const [conversaId, setConversaId] = useState<string | null>(null);
  const [conversaAberta, setConversaAberta] = useState(false);
  const [rascunho, setRascunho] = useState("");

  const conversasOrdenadas = useMemo(
    () =>
      [...app.conversas].sort(
        (a, b) =>
          new Date(b.ultimaAtividade).getTime() -
          new Date(a.ultimaAtividade).getTime(),
      ),
    [app.conversas],
  );

  const contagens = useMemo(
    () => ({
      todas: conversasOrdenadas.length,
      "nao-lidas": conversasOrdenadas.filter((c) => c.naoLidas > 0).length,
      cobranca: conversasOrdenadas.filter((c) => c.intencao === "cobranca")
        .length,
      agendamento: conversasOrdenadas.filter(
        (c) => c.intencao === "agendamento",
      ).length,
    }),
    [conversasOrdenadas],
  );

  const filtradas = useMemo(() => {
    let lista = conversasOrdenadas;
    if (aba === "nao-lidas") lista = lista.filter((c) => c.naoLidas > 0);
    if (aba === "cobranca")
      lista = lista.filter((c) => c.intencao === "cobranca");
    if (aba === "agendamento")
      lista = lista.filter((c) => c.intencao === "agendamento");
    if (busca.trim()) {
      const alvo = busca.trim().toLowerCase();
      lista = lista.filter(
        (c) =>
          c.contatoNome.toLowerCase().includes(alvo) ||
          c.mensagens.at(-1)?.texto.toLowerCase().includes(alvo),
      );
    }
    return lista;
  }, [conversasOrdenadas, aba, busca]);

  const conversa = useMemo(
    () => app.conversas.find((c) => c.id === conversaId) ?? null,
    [app.conversas, conversaId],
  );

  function abrirConversa(c: Conversa) {
    setConversaId(c.id);
    setConversaAberta(true);
    if (c.naoLidas > 0) app.marcarLida(c.id);
  }

  function enviar() {
    if (!conversa || !rascunho.trim()) return;
    if (conversa.modo === "ia") app.alternarModo(conversa.id);
    app.enviarMensagem(conversa.id, rascunho.trim());
    setRascunho("");
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] min-h-0 flex-col lg:flex-row">
      {/* Coluna esquerda — lista */}
      <div
        className={cx(
          "flex min-h-0 w-full shrink-0 flex-col border-ink-200 bg-white lg:flex lg:w-[360px] lg:border-r",
          conversaAberta ? "hidden lg:flex" : "flex",
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
          <div className="relative">
            <Icon
              name="search"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400"
            />
            <Input
              placeholder="Buscar conversa…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              aria-label="Buscar conversa"
              className="pl-9"
            />
          </div>
        </div>
        <div className="px-3 pt-3">
          <Abas2 aba={aba} aoMudar={setAba} contagens={contagens} />
        </div>
        <div className="scrollbar-thin flex-1 overflow-y-auto">
          {filtradas.length === 0 ? (
            <Vazio
              icone="chat"
              titulo="Nenhuma conversa encontrada"
              descricao="Tente outro termo de busca ou outro filtro."
            />
          ) : (
            <ul>
              {filtradas.map((c) => {
                const ultima = c.mensagens.at(-1);
                return (
                  <li key={c.id}>
                    <button
                      onClick={() => abrirConversa(c)}
                      className={cx(
                        "flex w-full items-start gap-3 border-b border-ink-100 px-4 py-3 text-left transition-colors hover:bg-ink-50",
                        conversaId === c.id && "bg-brand-50/70",
                      )}
                    >
                      <Avatar nome={c.contatoNome} cor={corAvatar(c.contatoNome)} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-[13.5px] font-medium text-ink-900">
                            {c.contatoNome}
                          </p>
                          <span className="shrink-0 text-[11px] text-ink-400">
                            {tempoRelativo(c.ultimaAtividade)}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-[13px] text-ink-500">
                          {ultima?.texto.replace(/\n/g, " ") ?? ""}
                        </p>
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <Badge tom={TOM_INTENCAO[c.intencao]}>
                            {NOME_INTENCAO[c.intencao]}
                          </Badge>
                          <Badge tom={c.modo === "ia" ? "marca" : "neutro"}>
                            {c.modo === "ia" ? "IA" : "Você"}
                          </Badge>
                          {c.naoLidas > 0 && (
                            <span className="ml-auto flex size-2 shrink-0 rounded-full bg-zap" />
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Coluna direita — conversa */}
      <div
        className={cx(
          "flex min-h-0 flex-1 flex-col",
          conversaAberta ? "flex" : "hidden lg:flex",
        )}
      >
        {!conversa ? (
          <div className="flex flex-1 items-center justify-center bg-ink-50/50">
            <Vazio
              icone="chat"
              titulo="Selecione uma conversa"
              descricao="Escolha um contato à esquerda para ver o histórico e o resumo que a IA preparou."
            />
          </div>
        ) : (
          <>
            {/* Cabeçalho */}
            <div className="flex items-center gap-3 border-b border-ink-200 bg-white px-4 py-3">
              <button
                onClick={() => setConversaAberta(false)}
                aria-label="Voltar"
                className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 lg:hidden"
              >
                <Icon name="chevronLeft" className="size-5" />
              </button>
              <Avatar nome={conversa.contatoNome} cor={corAvatar(conversa.contatoNome)} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold text-ink-900">
                  {conversa.contatoNome}
                </p>
                <p className="truncate text-xs text-ink-500">
                  {telefone(conversa.contatoTelefone)}
                </p>
              </div>
              <Botao
                variante="secundario"
                tamanho="sm"
                icone={conversa.modo === "ia" ? "user" : "spark"}
                onClick={() => app.alternarModo(conversa.id)}
              >
                {conversa.modo === "ia" ? "Assumir conversa" : "Devolver pra IA"}
              </Botao>
            </div>

            {/* Resumo da IA */}
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
                    {conversa.resumoIA}
                  </p>
                  {conversa.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {conversa.tags.map((t) => (
                        <Badge key={t} tom="marca">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Mensagens */}
            <div className="chat-bg scrollbar-thin flex-1 overflow-y-auto px-4 py-4">
              <div className="mx-auto flex max-w-xl flex-col gap-2.5">
                {conversa.mensagens.map((m) => {
                  if (m.autor === "sistema") {
                    return (
                      <div key={m.id} className="flex justify-center">
                        <span className="rounded-full bg-ink-900/8 px-3 py-1 text-[11.5px] text-ink-600">
                          {m.texto}
                        </span>
                      </div>
                    );
                  }
                  const daEmpresa = m.autor === "ia" || m.autor === "humano";
                  return (
                    <div
                      key={m.id}
                      className={cx(
                        "flex",
                        daEmpresa ? "justify-end" : "justify-start",
                      )}
                    >
                      <div
                        className={cx(
                          "max-w-[80%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed shadow-sm",
                          daEmpresa
                            ? "rounded-tr-sm bg-[#d9fdd3] text-ink-900"
                            : "rounded-tl-sm bg-white text-ink-900",
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
                            {m.autor === "ia" ? "IA" : "Você"}
                          </span>
                        )}
                        <p className="whitespace-pre-line">{m.texto}</p>
                        <p className="mt-1 text-right text-[10.5px] text-ink-400">
                          {hora(m.hora)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Envio */}
            <div className="border-t border-ink-200 bg-white px-4 py-3">
              {conversa.modo === "ia" && (
                <p className="mb-2 flex items-center gap-1.5 text-[12px] text-amber-600">
                  <Icon name="alert" className="size-3.5" />
                  Enviar uma mensagem vai assumir esta conversa — a IA fica pausada
                  neste contato.
                </p>
              )}
              <form
                className="flex items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  enviar();
                }}
              >
                <Input
                  value={rascunho}
                  onChange={(e) => setRascunho(e.target.value)}
                  placeholder="Escreva uma mensagem…"
                  aria-label="Mensagem"
                  className="flex-1"
                />
                <Botao
                  type="submit"
                  variante="zap"
                  icone="send"
                  disabled={!rascunho.trim()}
                >
                  Enviar
                </Botao>
              </form>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Abas2({
  aba,
  aoMudar,
  contagens,
}: {
  aba: FiltroAba;
  aoMudar: (a: FiltroAba) => void;
  contagens: Record<FiltroAba, number>;
}) {
  const itens: { id: FiltroAba; nome: string }[] = [
    { id: "todas", nome: "Todas" },
    { id: "nao-lidas", nome: "Não lidas" },
    { id: "cobranca", nome: "Cobrança" },
    { id: "agendamento", nome: "Agendamento" },
  ];
  return (
    <div className="flex gap-1 overflow-x-auto rounded-xl bg-ink-100 p-1">
      {itens.map((item) => (
        <button
          key={item.id}
          onClick={() => aoMudar(item.id)}
          className={cx(
            "flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium transition-all",
            aba === item.id
              ? "bg-white text-ink-900 shadow-sm"
              : "text-ink-500 hover:text-ink-800",
          )}
        >
          {item.nome}
          <span
            className={cx(
              "rounded-full px-1.5 text-[10.5px]",
              aba === item.id
                ? "bg-brand-100 text-brand-700"
                : "bg-ink-200 text-ink-600",
            )}
          >
            {contagens[item.id]}
          </span>
        </button>
      ))}
    </div>
  );
}

export default function AtendimentoPage() {
  const app = useApp();
  if (!app.tem("atendimento")) return <Bloqueado feature="atendimento" />;
  return <AtendimentoConteudo />;
}
