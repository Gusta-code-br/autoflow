"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useMemo, useRef, useState } from "react";
import { Bloqueado } from "@/components/shell";
import { Icon } from "@/components/icons";
import {
  Badge,
  Botao,
  Campo,
  Card,
  CardTitulo,
  Input,
  Modal,
  Select,
  Switch,
  Textarea,
  cx,
} from "@/components/ui";
import { useApp } from "@/lib/store";
import { VARIAVEIS_MENSAGEM } from "@/lib/mock-data";
import { brl, dataHora } from "@/lib/format";
import {
  ICONE_ACAO,
  ROTULO_ACAO,
  ROTULO_CONDICAO,
  contextoDaCobranca,
  contextoExemplo,
  novaEtapa,
  novaRegua,
  preencherVariaveis,
  rotuloCurto,
  rotuloQuando,
  simularRegua,
} from "@/lib/regua";
import type {
  Acao,
  Condicao,
  EtapaRegua,
  Referencia,
  Regua,
} from "@/lib/types";

export default function ReguaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const app = useApp();
  if (!app.tem("cobranca")) return <Bloqueado feature="cobranca" />;
  return <Editor id={id} />;
}

function Editor({ id }: { id: string }) {
  const app = useApp();
  const router = useRouter();

  const original = useMemo(
    () => app.reguas.find((r) => r.id === id) ?? novaRegua(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id],
  );

  const [regua, setRegua] = useState<Regua>(() => structuredClone(original));
  const [selecionada, setSelecionada] = useState<string>(
    original.etapas[0]?.id ?? "",
  );
  const [simular, setSimular] = useState(false);
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const etapa = regua.etapas.find((e) => e.id === selecionada) ?? null;

  function mudar(patch: Partial<Regua>) {
    setRegua((r) => ({ ...r, ...patch }));
  }

  function mudarEtapa(etapaId: string, patch: Partial<EtapaRegua>) {
    setRegua((r) => ({
      ...r,
      etapas: r.etapas.map((e) => (e.id === etapaId ? { ...e, ...patch } : e)),
    }));
  }

  function adicionarEtapa() {
    const ultima = regua.etapas[regua.etapas.length - 1];
    const nova = novaEtapa((ultima?.offsetDias ?? 0) + 3);
    setRegua((r) => ({ ...r, etapas: [...r.etapas, nova] }));
    setSelecionada(nova.id);
  }

  function removerEtapa(etapaId: string) {
    setRegua((r) => ({ ...r, etapas: r.etapas.filter((e) => e.id !== etapaId) }));
    if (selecionada === etapaId) setSelecionada(regua.etapas[0]?.id ?? "");
  }

  function inserirVariavel(chave: string) {
    if (!etapa) return;
    const area = areaRef.current;
    if (!area) {
      mudarEtapa(etapa.id, { mensagem: etapa.mensagem + " " + chave });
      return;
    }
    const ini = area.selectionStart;
    const fim = area.selectionEnd;
    const texto = etapa.mensagem.slice(0, ini) + chave + etapa.mensagem.slice(fim);
    mudarEtapa(etapa.id, { mensagem: texto });
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(ini + chave.length, ini + chave.length);
    });
  }

  function salvar() {
    app.salvarRegua({
      ...regua,
      etapas: [...regua.etapas].sort((a, b) => a.offsetDias - b.offsetDias),
    });
    app.notificar(`Régua "${regua.nome}" salva.`);
    router.push("/painel/cobranca");
  }

  const etapasOrdenadas = [...regua.etapas].sort(
    (a, b) => a.offsetDias - b.offsetDias,
  );

  const ctx = contextoExemplo(app.conta);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8">
      {/* Cabeçalho */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Link
            href="/painel/cobranca"
            className="inline-flex items-center gap-1 text-[13px] text-ink-500 transition-colors hover:text-ink-800"
          >
            <Icon name="chevronLeft" className="size-3.5" />
            Voltar para cobrança
          </Link>
          <input
            value={regua.nome}
            onChange={(e) => mudar({ nome: e.target.value })}
            className="mt-1.5 w-full max-w-xl rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-xl font-semibold tracking-tight text-ink-900 hover:border-ink-200 focus:border-brand-400 focus:bg-white focus:outline-none lg:text-2xl"
            aria-label="Nome da régua"
          />
          <input
            value={regua.descricao}
            onChange={(e) => mudar({ descricao: e.target.value })}
            placeholder="Descreva pra que serve essa régua…"
            className="mt-0.5 w-full max-w-xl rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-sm text-ink-500 hover:border-ink-200 focus:border-brand-400 focus:bg-white focus:outline-none"
            aria-label="Descrição da régua"
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-xl border border-ink-200 bg-white px-3 py-2">
            <span className="text-[13px] font-medium text-ink-700">
              {regua.ativa ? "Ativa" : "Pausada"}
            </span>
            <Switch
              ativo={regua.ativa}
              onChange={(v) => mudar({ ativa: v })}
              label="Régua ativa"
            />
          </div>
          <Botao variante="secundario" icone="play" onClick={() => setSimular(true)}>
            Simular
          </Botao>
          <Botao icone="check" onClick={salvar}>
            Salvar
          </Botao>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* ---------------------------------------------- coluna esquerda */}
        <div className="min-w-0 space-y-6">
          <Card>
            <CardTitulo
              titulo="Quando essa régua roda"
              subtitulo="Vale para as cobranças que você marcar com ela."
            />
            <div className="space-y-4 p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo label="Aplicar a">
                  <Select
                    value={regua.aplicarA}
                    onChange={(e) =>
                      mudar({ aplicarA: e.target.value as Regua["aplicarA"] })
                    }
                  >
                    <option value="todas">Todas as cobranças</option>
                    <option value="tag">Só as cobranças com uma etiqueta</option>
                  </Select>
                </Campo>
                {regua.aplicarA === "tag" && (
                  <Campo label="Etiqueta" dica="Ex.: mensalidade, pacote, avulso">
                    <Input
                      value={regua.tag ?? ""}
                      onChange={(e) => mudar({ tag: e.target.value })}
                      placeholder="mensalidade"
                    />
                  </Campo>
                )}
              </div>
              <div className="space-y-3 rounded-xl bg-ink-50 p-4">
                <Switch
                  ativo={regua.pausarAoPagar}
                  onChange={(v) => mudar({ pausarAoPagar: v })}
                  label="Parar assim que o cliente pagar"
                  descricao="Ninguém recebe cobrança depois de pagar. Recomendado."
                />
                <Switch
                  ativo={regua.pausarAoResponder}
                  onChange={(v) => mudar({ pausarAoResponder: v })}
                  label="Parar quando o cliente responder"
                  descricao="A conversa vai pro atendimento e a régua segura as próximas mensagens."
                />
              </div>
            </div>
          </Card>

          {/* Linha do tempo de etapas */}
          <div>
            <div className="mb-3 flex items-end justify-between">
              <div>
                <h2 className="text-[15px] font-semibold text-ink-900">
                  Etapas da automação
                </h2>
                <p className="text-[13px] text-ink-500">
                  Clique numa etapa pra editar a mensagem.
                </p>
              </div>
              <Botao tamanho="sm" variante="secundario" icone="plus" onClick={adicionarEtapa}>
                Adicionar etapa
              </Botao>
            </div>

            <ol className="relative space-y-3 pl-8">
              <span className="absolute left-[15px] top-2 bottom-2 w-px bg-ink-200" />
              {etapasOrdenadas.map((e) => {
                const ativa = e.id === selecionada;
                return (
                  <li key={e.id} className="relative">
                    <span
                      className={cx(
                        "absolute -left-8 top-3 flex size-8 items-center justify-center rounded-full border-2 text-[10px] font-semibold transition-colors",
                        ativa
                          ? "border-brand-600 bg-brand-600 text-white"
                          : e.ativa
                            ? "border-ink-200 bg-white text-ink-500"
                            : "border-dashed border-ink-300 bg-ink-50 text-ink-400",
                      )}
                    >
                      {rotuloCurto(e)}
                    </span>
                    <button
                      onClick={() => setSelecionada(e.id)}
                      className={cx(
                        "w-full rounded-2xl border bg-white p-4 text-left transition-all",
                        ativa
                          ? "border-brand-400 ring-4 ring-brand-500/10"
                          : "border-ink-200 hover:border-ink-300",
                        !e.ativa && "opacity-60",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Icon
                              name={ICONE_ACAO[e.acao]}
                              className="size-3.5 text-brand-600"
                            />
                            <span className="text-sm font-medium text-ink-900">
                              {ROTULO_ACAO[e.acao]}
                            </span>
                            {e.anexarPix && (
                              <Badge tom="sucesso" icone="pix">
                                PIX
                              </Badge>
                            )}
                            {e.condicao !== "sempre" && (
                              <Badge tom="neutro">
                                {ROTULO_CONDICAO[e.condicao]}
                              </Badge>
                            )}
                          </div>
                          <p className="mt-1 text-[13px] text-ink-500">
                            {rotuloQuando(e)}
                          </p>
                          <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-ink-600">
                            {preencherVariaveis(e.mensagem, ctx)}
                          </p>
                        </div>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            removerEtapa(e.id);
                          }}
                          onKeyDown={(ev) => {
                            if (ev.key === "Enter") {
                              ev.stopPropagation();
                              removerEtapa(e.id);
                            }
                          }}
                          className="shrink-0 rounded-lg p-1.5 text-ink-300 transition-colors hover:bg-rose-50 hover:text-rose-600"
                          aria-label="Remover etapa"
                        >
                          <Icon name="trash" className="size-4" />
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
              <li className="relative">
                <span className="absolute -left-8 top-2 flex size-8 items-center justify-center rounded-full border-2 border-dashed border-ink-300 bg-white text-ink-400">
                  <Icon name="plus" className="size-3.5" />
                </span>
                <button
                  onClick={adicionarEtapa}
                  className="w-full rounded-2xl border border-dashed border-ink-300 p-3.5 text-left text-[13px] text-ink-500 transition-colors hover:border-brand-400 hover:text-brand-700"
                >
                  Adicionar mais uma etapa
                </button>
              </li>
            </ol>
          </div>
        </div>

        {/* ---------------------------------------------- coluna direita */}
        <div className="space-y-6 lg:sticky lg:top-20 lg:self-start">
          {etapa ? (
            <>
              <Card>
                <CardTitulo titulo="Configurar etapa" subtitulo={rotuloQuando(etapa)} />
                <div className="space-y-4 p-5">
                  <div className="grid grid-cols-2 gap-3">
                    <Campo label="Quantos dias">
                      <Input
                        type="number"
                        value={etapa.offsetDias}
                        onChange={(ev) =>
                          mudarEtapa(etapa.id, {
                            offsetDias: Number(ev.target.value),
                          })
                        }
                      />
                    </Campo>
                    <Campo label="Horário">
                      <Input
                        type="time"
                        value={etapa.hora}
                        onChange={(ev) =>
                          mudarEtapa(etapa.id, { hora: ev.target.value })
                        }
                      />
                    </Campo>
                  </div>
                  <p className="-mt-2 text-xs text-ink-400">
                    Use número negativo para <strong>antes</strong> e positivo para{" "}
                    <strong>depois</strong>.
                  </p>

                  <Campo label="Contado a partir">
                    <Select
                      value={etapa.referencia}
                      onChange={(ev) =>
                        mudarEtapa(etapa.id, {
                          referencia: ev.target.value as Referencia,
                        })
                      }
                    >
                      <option value="vencimento">Do vencimento</option>
                      <option value="emissao">Da emissão da cobrança</option>
                      <option value="pagamento">Do pagamento</option>
                    </Select>
                  </Campo>

                  <Campo label="Só disparar se">
                    <Select
                      value={etapa.condicao}
                      onChange={(ev) =>
                        mudarEtapa(etapa.id, {
                          condicao: ev.target.value as Condicao,
                        })
                      }
                    >
                      {(
                        Object.keys(ROTULO_CONDICAO) as Condicao[]
                      ).map((c) => (
                        <option key={c} value={c}>
                          {ROTULO_CONDICAO[c]}
                        </option>
                      ))}
                    </Select>
                  </Campo>

                  <Campo label="O que fazer">
                    <Select
                      value={etapa.acao}
                      onChange={(ev) =>
                        mudarEtapa(etapa.id, { acao: ev.target.value as Acao })
                      }
                    >
                      {(Object.keys(ROTULO_ACAO) as Acao[]).map((a) => (
                        <option key={a} value={a}>
                          {ROTULO_ACAO[a]}
                        </option>
                      ))}
                    </Select>
                  </Campo>

                  {etapa.acao !== "marcar_perdido" && (
                    <Campo label="Mensagem">
                      <Textarea
                        ref={areaRef}
                        rows={5}
                        value={etapa.mensagem}
                        onChange={(ev) =>
                          mudarEtapa(etapa.id, { mensagem: ev.target.value })
                        }
                      />
                    </Campo>
                  )}

                  {etapa.acao !== "marcar_perdido" && (
                    <div>
                      <p className="mb-1.5 text-[13px] font-medium text-ink-700">
                        Inserir informação do cliente
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {VARIAVEIS_MENSAGEM.map((v) => (
                          <button
                            key={v.chave}
                            onClick={() => inserirVariavel(v.chave)}
                            title={`${v.desc} — ex.: ${v.exemplo}`}
                            className="rounded-lg bg-ink-100 px-2 py-1 font-mono text-[11px] text-ink-600 transition-colors hover:bg-brand-100 hover:text-brand-800"
                          >
                            {v.chave}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="space-y-3 border-t border-ink-100 pt-4">
                    <Switch
                      ativo={etapa.anexarPix}
                      onChange={(v) => mudarEtapa(etapa.id, { anexarPix: v })}
                      label="Mandar o PIX junto"
                      descricao="QR Code e copia e cola na mesma mensagem."
                    />
                    <Switch
                      ativo={etapa.ativa}
                      onChange={(v) => mudarEtapa(etapa.id, { ativa: v })}
                      label="Etapa ativa"
                    />
                  </div>
                </div>
              </Card>

              {/* Prévia */}
              <Card className="overflow-hidden">
                <CardTitulo
                  titulo="Como o cliente vai ver"
                  subtitulo="Prévia com dados de exemplo"
                />
                <div className="chat-bg space-y-2 p-4">
                  <div className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-[#d9fdd3] px-3 py-2 shadow-sm">
                    <p className="whitespace-pre-line text-[13px] leading-relaxed text-ink-800">
                      {preencherVariaveis(etapa.mensagem, ctx)}
                    </p>
                    {etapa.anexarPix && (
                      <div className="mt-2 rounded-xl bg-white/70 p-2.5">
                        <div className="flex items-center gap-2">
                          <Icon name="pix" className="size-4 text-emerald-600" />
                          <span className="text-[11px] font-medium text-ink-700">
                            PIX copia e cola
                          </span>
                        </div>
                        <p className="mt-1 truncate font-mono text-[10px] text-ink-500">
                          00020126580014BR.GOV.BCB.PIX0136…
                        </p>
                      </div>
                    )}
                    <p className="mt-1 text-right text-[10px] text-ink-400">
                      {etapa.hora} ✓✓
                    </p>
                  </div>
                  {etapa.acao === "oferecer_parcelamento" && (
                    <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-white px-3 py-2 shadow-sm">
                      <p className="text-[13px] text-ink-800">
                        Consigo em 3x sim, pode mandar
                      </p>
                    </div>
                  )}
                </div>
              </Card>
            </>
          ) : (
            <Card className="p-8 text-center text-sm text-ink-500">
              Adicione uma etapa para começar.
            </Card>
          )}

          <button
            onClick={() => setConfirmarExclusao(true)}
            className="w-full rounded-xl border border-ink-200 py-2.5 text-[13px] text-ink-500 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
          >
            Excluir esta régua
          </button>
        </div>
      </div>

      <ModalSimulacao
        aberto={simular}
        aoFechar={() => setSimular(false)}
        regua={regua}
      />

      <Modal
        aberto={confirmarExclusao}
        aoFechar={() => setConfirmarExclusao(false)}
        titulo="Excluir régua?"
        subtitulo="As cobranças ligadas a ela param de receber mensagens."
        largura="max-w-md"
        rodape={
          <>
            <Botao variante="secundario" onClick={() => setConfirmarExclusao(false)}>
              Manter
            </Botao>
            <Botao
              variante="perigo"
              icone="trash"
              onClick={() => {
                app.removerRegua(regua.id);
                app.notificar("Régua excluída.", "info");
                router.push("/painel/cobranca");
              }}
            >
              Excluir
            </Botao>
          </>
        }
      >
        <p className="text-sm text-ink-600">
          Essa ação não pode ser desfeita no protótipo.
        </p>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------ Simulação */

function ModalSimulacao({
  aberto,
  aoFechar,
  regua,
}: {
  aberto: boolean;
  aoFechar: () => void;
  regua: Regua;
}) {
  const app = useApp();
  const candidatas = app.cobrancas.filter((c) => c.status !== "cancelado");
  const [cobId, setCobId] = useState(candidatas[0]?.id ?? "");
  const cobranca = candidatas.find((c) => c.id === cobId) ?? candidatas[0];

  const linha = cobranca ? simularRegua(regua, cobranca) : [];

  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      titulo="Simular régua"
      subtitulo="Veja exatamente o que o cliente receberia, e quando."
      largura="max-w-2xl"
      rodape={
        <Botao variante="secundario" onClick={aoFechar}>
          Fechar
        </Botao>
      }
    >
      {!cobranca ? (
        <p className="text-sm text-ink-500">
          Crie uma cobrança para simular a régua.
        </p>
      ) : (
        <div className="space-y-4">
          <Campo label="Simular com a cobrança de">
            <Select value={cobId} onChange={(e) => setCobId(e.target.value)}>
              {candidatas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.clienteNome} — {brl(c.valor)} ({c.descricao})
                </option>
              ))}
            </Select>
          </Campo>

          <ol className="relative space-y-3 pl-7">
            <span className="absolute left-[11px] top-2 bottom-2 w-px bg-ink-200" />
            {linha.map(({ etapa, quando, passado }) => (
              <li key={etapa.id} className="relative">
                <span
                  className={cx(
                    "absolute -left-7 top-2.5 flex size-6 items-center justify-center rounded-full border-2",
                    passado
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : "border-ink-300 bg-white text-ink-400",
                  )}
                >
                  <Icon
                    name={passado ? "check" : ICONE_ACAO[etapa.acao]}
                    className="size-3"
                  />
                </span>
                <div
                  className={cx(
                    "rounded-xl border p-3",
                    passado ? "border-ink-200 bg-ink-50" : "border-ink-200 bg-white",
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[13px] font-medium text-ink-800">
                      {ROTULO_ACAO[etapa.acao]}
                    </span>
                    <span
                      className={cx(
                        "text-xs",
                        passado ? "text-ink-400" : "text-brand-600",
                      )}
                    >
                      {passado ? "já teria saído em " : "sai em "}
                      {dataHora(quando.toISOString())}
                    </span>
                  </div>
                  <p className="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed text-ink-600">
                    {preencherVariaveis(
                      etapa.mensagem,
                      contextoDaCobranca(cobranca, app.conta),
                    )}
                  </p>
                  {!etapa.ativa && (
                    <p className="mt-1.5 text-xs text-amber-600">
                      Etapa desativada — não seria enviada.
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>

          <p className="rounded-xl bg-brand-50 p-3 text-[13px] text-brand-800">
            <Icon name="spark" className="mr-1 inline size-3.5" />
            Se {cobranca.clienteNome.split(" ")[0]} pagar no meio do caminho
            {regua.pausarAoPagar
              ? ", a régua para na hora e ninguém recebe mais nada."
              : ", as próximas mensagens continuam saindo (recomendamos ligar a parada automática)."}
          </p>
          <p className="text-center text-xs text-ink-400">
            Simulação com os dados atuais desta cobrança.
          </p>
        </div>
      )}
    </Modal>
  );
}
