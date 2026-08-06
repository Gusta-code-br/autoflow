"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";

import { AvisoForm, BotaoEnviar } from "@/components/form";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { Badge, Botao, Campo, Card, CardTitulo, Input, Modal, Select, Switch, Textarea } from "@/components/ui";
import { cx } from "@/lib/cx";
import { ESTADO_INICIAL } from "@/lib/form";
import { brl, dataHora } from "@/lib/format";
import {
  ICONE_ACAO,
  ROTULO_ACAO,
  ROTULO_CONDICAO,
  rotuloCurto,
  rotuloQuando,
} from "@/lib/regua-ui";
import { arquivarReguaAction, salvarReguaAction } from "@/server/actions/reguas";
import { centavosParaReais } from "@/server/dominio/dinheiro";
import {
  materializarDisparos,
  type AcaoEtapa,
  type Condicao,
  type Referencia,
} from "@/server/dominio/regua";
import {
  VARIAVEIS_MENSAGEM,
  preencherVariaveis,
  type ChaveVariavel,
} from "@/server/dominio/variaveis";

/* ------------------------------------------------------------------ tipos */

export interface EtapaEditavel {
  /** Chave estável de React. Etapa nova ainda não tem id no banco. */
  chave: string;
  id: string | null;
  referencia: Referencia;
  offsetDias: number;
  hora: string;
  condicao: Condicao;
  acao: AcaoEtapa;
  mensagem: string;
  templateId: string | null;
  anexarPix: boolean;
  ativa: boolean;
}

export interface ReguaEditavel {
  id: string | null;
  nome: string;
  descricao: string;
  ativa: boolean;
  aplicarA: "todas" | "tag";
  tag: string;
  pausarAoResponder: boolean;
  pausarAoPagar: boolean;
  padrao: boolean;
  etapas: EtapaEditavel[];
}

export interface CobrancaExemplo {
  id: string;
  cliente: string;
  descricao: string;
  valorCentavos: number;
  /** 'YYYY-MM-DD' */
  vencimento: string;
  criadoEm: string;
  pagoEm: string | null;
  status: string;
}

export interface ConfigEditor {
  fuso: string;
  horarioInicio: string;
  horarioFim: string;
  diasSemana: number[];
  nomeEmpresa: string;
  nomeAtendente: string;
  chavePix: string | null;
}

const VARIAVEIS = Object.entries(VARIAVEIS_MENSAGEM) as [ChaveVariavel, string][];

/** Erro do servidor em `etapas.2.mensagem` → índice 2. */
function indiceDoErro(campos: Record<string, string> | undefined): number | null {
  if (!campos) return null;
  for (const chave of Object.keys(campos)) {
    const m = /^etapas\.(\d+)\./.exec(chave);
    if (m) return Number(m[1]);
  }
  return null;
}

function erroDaEtapa(
  campos: Record<string, string> | undefined,
  indice: number,
  campo: string,
): string | undefined {
  return campos?.[`etapas.${indice}.${campo}`];
}

/* ----------------------------------------------------------------- editor */

export function Editor({
  regua: inicial,
  novo,
  emAndamento,
  cobrancas,
  config,
}: {
  regua: ReguaEditavel;
  novo: boolean;
  emAndamento: number;
  cobrancas: CobrancaExemplo[];
  config: ConfigEditor;
}) {
  const { notificar } = useToast();
  const [regua, setRegua] = useState<ReguaEditavel>(inicial);
  const [selecionada, setSelecionada] = useState<string>(
    inicial.etapas[0]?.chave ?? "",
  );
  const [simular, setSimular] = useState(false);
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const [estado, salvar] = useActionState(salvarReguaAction, ESTADO_INICIAL);

  /*
   * A ordem que vale é a do tempo, não a de digitação: quem muda uma etapa de
   * "3 dias antes" para "10 depois" espera vê-la descer na linha. O servidor
   * grava `ordem` pela posição no array, então é esta lista que vai no submit.
   */
  const etapas = useMemo(
    () => [...regua.etapas].sort((a, b) => a.offsetDias - b.offsetDias),
    [regua.etapas],
  );
  const etapa = etapas.find((e) => e.chave === selecionada) ?? null;
  const indiceSelecionada = etapas.findIndex((e) => e.chave === selecionada);

  /*
   * Erro dentro de etapa: abre a etapa culpada em vez de deixar o usuário
   * procurar qual das oito linhas o servidor recusou. É um ajuste na hora em
   * que a resposta chega — não um efeito — para o painel já pintar aberto na
   * etapa certa, e para não voltar a arrastar o foco se ele clicar em outra.
   */
  const [respostaVista, setRespostaVista] = useState(estado);
  if (estado !== respostaVista) {
    setRespostaVista(estado);
    const i = indiceDoErro(estado.campos);
    if (i !== null && etapas[i]) setSelecionada(etapas[i].chave);
  }

  useEffect(() => {
    if (estado.ok && estado.mensagem) notificar(estado.mensagem);
  }, [estado, notificar]);

  function mudar(patch: Partial<ReguaEditavel>) {
    setRegua((r) => ({ ...r, ...patch }));
  }

  function mudarEtapa(chave: string, patch: Partial<EtapaEditavel>) {
    setRegua((r) => ({
      ...r,
      etapas: r.etapas.map((e) => (e.chave === chave ? { ...e, ...patch } : e)),
    }));
  }

  function adicionarEtapa() {
    const ultima = etapas[etapas.length - 1];
    const nova: EtapaEditavel = {
      chave: `nova-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      id: null,
      referencia: ultima?.referencia ?? "vencimento",
      offsetDias: (ultima?.offsetDias ?? 0) + 3,
      hora: ultima?.hora ?? "09:00",
      condicao: "se_nao_pago",
      acao: "enviar_whatsapp",
      mensagem: "",
      templateId: null,
      anexarPix: false,
      ativa: true,
    };
    setRegua((r) => ({ ...r, etapas: [...r.etapas, nova] }));
    setSelecionada(nova.chave);
  }

  function removerEtapa(chave: string) {
    const restantes = regua.etapas.filter((e) => e.chave !== chave);
    setRegua((r) => ({ ...r, etapas: restantes }));
    if (selecionada === chave) setSelecionada(restantes[0]?.chave ?? "");
  }

  function inserirVariavel(chave: string) {
    if (!etapa) return;
    const marcador = `{{${chave}}}`;
    const area = areaRef.current;
    if (!area) {
      mudarEtapa(etapa.chave, { mensagem: `${etapa.mensagem} ${marcador}` });
      return;
    }
    const ini = area.selectionStart;
    const fim = area.selectionEnd;
    const texto =
      etapa.mensagem.slice(0, ini) + marcador + etapa.mensagem.slice(fim);
    mudarEtapa(etapa.chave, { mensagem: texto });
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(ini + marcador.length, ini + marcador.length);
    });
  }

  /* O que o servidor recebe: o desenho inteiro, sem chave de React. */
  const payload = etapas.map((e) => ({
    id: e.id,
    referencia: e.referencia,
    offsetDias: e.offsetDias,
    hora: e.hora,
    condicao: e.condicao,
    acao: e.acao,
    mensagem: e.acao === "enviar_whatsapp" ? e.mensagem : undefined,
    templateId: e.templateId,
    anexarPix: e.anexarPix,
    ativa: e.ativa,
  }));

  return (
    <form action={salvar} className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8">
      {/* O desenho vai num campo só: `etapas[3][hora]` transformaria a ordem —
          que aqui é dado semântico — em detalhe do nome do input. */}
      <input type="hidden" name="id" value={regua.id ?? ""} />
      <input type="hidden" name="nome" value={regua.nome} />
      <input type="hidden" name="descricao" value={regua.descricao} />
      <input type="hidden" name="ativa" value={regua.ativa ? "on" : ""} />
      <input type="hidden" name="aplicarA" value={regua.aplicarA} />
      <input type="hidden" name="tag" value={regua.aplicarA === "tag" ? regua.tag : ""} />
      <input
        type="hidden"
        name="pausarAoResponder"
        value={regua.pausarAoResponder ? "on" : ""}
      />
      <input
        type="hidden"
        name="pausarAoPagar"
        value={regua.pausarAoPagar ? "on" : ""}
      />
      <input type="hidden" name="padrao" value={regua.padrao ? "on" : ""} />
      <input type="hidden" name="etapas" value={JSON.stringify(payload)} />

      {/* ------------------------------------------------------------ topo */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/painel/cobranca"
            className="rounded-lg border border-ink-200 bg-white p-2 text-ink-500 transition-colors hover:bg-ink-50 hover:text-ink-900"
            aria-label="Voltar para cobrança"
          >
            <Icon name="chevronLeft" className="size-4" />
          </Link>
          <div className="min-w-0">
            <input
              value={regua.nome}
              onChange={(ev) => mudar({ nome: ev.target.value })}
              placeholder="Nome da régua"
              aria-label="Nome da régua"
              className="w-full max-w-xl rounded-lg border border-transparent bg-transparent px-2 py-1 text-xl font-semibold tracking-tight text-ink-900 outline-none transition-colors focus:border-ink-200 focus:bg-white lg:text-2xl"
            />
            {estado.campos?.nome && (
              <p className="px-2 text-[13px] text-rose-600">{estado.campos.nome}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge tom={regua.ativa ? "sucesso" : "neutro"}>
            {regua.ativa ? "Ativa" : "Pausada"}
          </Badge>
          <Botao
            variante="secundario"
            icone="play"
            type="button"
            onClick={() => setSimular(true)}
          >
            Simular
          </Botao>
          <BotaoEnviar enviando="Salvando…">Salvar régua</BotaoEnviar>
        </div>
      </div>

      <AvisoForm estado={estado} />

      {emAndamento > 0 && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] leading-relaxed text-amber-800">
          <strong>{emAndamento}</strong>{" "}
          {emAndamento === 1 ? "cobrança está" : "cobranças estão"} correndo nesta
          régua agora. Mensagens já agendadas continuam com o desenho antigo; o
          novo vale para as próximas.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* --------------------------------------------------- coluna esquerda */}
        <div className="space-y-4">
          <Card>
            <CardTitulo
              titulo="Quando essa régua roda"
              subtitulo="Vale para as cobranças que você marcar com ela."
            />
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Campo label="Aplicar a">
                <Select
                  value={regua.aplicarA}
                  onChange={(ev) =>
                    mudar({ aplicarA: ev.target.value as "todas" | "tag" })
                  }
                >
                  <option value="todas">Todas as cobranças</option>
                  <option value="tag">Só as cobranças com uma etiqueta</option>
                </Select>
              </Campo>
              {regua.aplicarA === "tag" && (
                <Campo label="Etiqueta" erro={estado.campos?.tag}>
                  <Input
                    value={regua.tag}
                    onChange={(ev) => mudar({ tag: ev.target.value })}
                    placeholder="Ex.: mensalidade, pacote, avulso"
                  />
                </Campo>
              )}
              <Campo label="Descrição" dica="Só para você lembrar depois.">
                <Input
                  value={regua.descricao}
                  onChange={(ev) => mudar({ descricao: ev.target.value })}
                  placeholder="A conversa vai ficando mais firme a cada etapa"
                />
              </Campo>
            </div>

            <div className="mt-4 space-y-3 border-t border-ink-100 pt-4">
              <Switch
                ativo={regua.ativa}
                onChange={(v) => mudar({ ativa: v })}
                label="Régua ativa"
                descricao="Pausada, ela para de agendar mensagens novas."
              />
              <Switch
                ativo={regua.pausarAoResponder}
                onChange={(v) => mudar({ pausarAoResponder: v })}
                label="Parar quando o cliente responder"
                descricao="Ninguém recebe cobrança automática depois de pedir prazo. Recomendado."
              />
              <Switch
                ativo={regua.pausarAoPagar}
                onChange={(v) => mudar({ pausarAoPagar: v })}
                label="Parar assim que o cliente pagar"
                descricao="A régua sai da frente no minuto em que o pagamento entra."
              />
              <Switch
                ativo={regua.padrao}
                onChange={(v) => mudar({ padrao: v })}
                label="Usar como padrão em cobranças novas"
                descricao="Só uma régua pode ser a padrão."
              />
            </div>
          </Card>

          {/* --------------------------------------------- linha do tempo */}
          <Card>
            <div className="flex items-center justify-between gap-3">
              <CardTitulo
                titulo="Etapas da automação"
                subtitulo="A linha do tempo de cada cobrança que entrar aqui."
              />
              <Botao
                variante="secundario"
                icone="plus"
                type="button"
                onClick={adicionarEtapa}
              >
                Adicionar
              </Botao>
            </div>

            {estado.campos?.etapas && (
              <p className="mt-3 text-[13px] text-rose-600">{estado.campos.etapas}</p>
            )}

            <ol className="relative mt-4 space-y-2 pl-8">
              {/* Linha vertical que costura os marcadores. */}
              <span
                className="absolute left-3 top-2 bottom-2 w-px bg-ink-200"
                aria-hidden
              />
              {etapas.map((e, i) => {
                const temErro = Boolean(
                  erroDaEtapa(estado.campos, i, "mensagem") ??
                    erroDaEtapa(estado.campos, i, "hora"),
                );
                return (
                  <li key={e.chave} className="relative">
                    <span
                      className={cx(
                        "absolute -left-8 top-2 flex size-6 items-center justify-center rounded-full border-2 bg-white text-[10px] font-semibold",
                        e.chave === selecionada
                          ? "border-brand-600 text-brand-700"
                          : e.ativa
                            ? "border-ink-300 text-ink-500"
                            : "border-dashed border-ink-300 text-ink-400",
                      )}
                    >
                      {rotuloCurto(e)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelecionada(e.chave)}
                      className={cx(
                        "w-full rounded-xl border p-3 text-left transition-colors",
                        e.chave === selecionada
                          ? "border-brand-600 bg-brand-50/60 ring-1 ring-brand-600/10"
                          : "border-ink-200 bg-white hover:bg-ink-50",
                        temErro && "border-rose-300 bg-rose-50/60",
                        !e.ativa && "opacity-60",
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Icon name={ICONE_ACAO[e.acao]} className="size-4 text-ink-500" />
                        <span className="text-sm font-medium text-ink-900">
                          {ROTULO_ACAO[e.acao]}
                        </span>
                        {e.condicao !== "sempre" && (
                          <Badge tom="neutro">{ROTULO_CONDICAO[e.condicao]}</Badge>
                        )}
                        {e.anexarPix && <Badge tom="info">PIX</Badge>}
                        {!e.ativa && <Badge tom="neutro">desligada</Badge>}
                      </div>
                      <p className="mt-1 text-[13px] text-ink-500">{rotuloQuando(e)}</p>
                      {e.acao === "enviar_whatsapp" && e.mensagem && (
                        <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-ink-600">
                          {e.mensagem}
                        </p>
                      )}
                    </button>
                  </li>
                );
              })}
            </ol>

            {etapas.length === 0 && (
              <p className="mt-4 rounded-xl border border-dashed border-ink-300 p-6 text-center text-sm text-ink-500">
                Nenhuma etapa ainda. Adicione a primeira para a régua fazer alguma
                coisa.
              </p>
            )}
          </Card>
        </div>

        {/* ---------------------------------------------------- coluna direita */}
        <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          {etapa ? (
            <Card>
              <div className="flex items-start justify-between gap-3">
                <CardTitulo
                  titulo="Configurar etapa"
                  subtitulo={rotuloQuando(etapa)}
                />
                <button
                  type="button"
                  onClick={() => removerEtapa(etapa.chave)}
                  className="rounded-lg p-2 text-ink-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
                  aria-label="Remover etapa"
                >
                  <Icon name="trash" className="size-4" />
                </button>
              </div>

              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <Campo
                    label="Dias"
                    dica="Negativo = antes."
                    erro={erroDaEtapa(estado.campos, indiceSelecionada, "offsetDias")}
                  >
                    <Input
                      type="number"
                      value={String(etapa.offsetDias)}
                      onChange={(ev) =>
                        mudarEtapa(etapa.chave, {
                          offsetDias: Number(ev.target.value || 0),
                        })
                      }
                    />
                  </Campo>
                  <Campo
                    label="Horário"
                    erro={erroDaEtapa(estado.campos, indiceSelecionada, "hora")}
                  >
                    <Input
                      type="time"
                      value={etapa.hora}
                      onChange={(ev) =>
                        mudarEtapa(etapa.chave, { hora: ev.target.value })
                      }
                    />
                  </Campo>
                </div>

                <Campo label="Contado a partir de">
                  <Select
                    value={etapa.referencia}
                    onChange={(ev) =>
                      mudarEtapa(etapa.chave, {
                        referencia: ev.target.value as Referencia,
                      })
                    }
                  >
                    <option value="vencimento">Do vencimento</option>
                    <option value="emissao">Da criação da cobrança</option>
                    <option value="pagamento">Do pagamento</option>
                  </Select>
                </Campo>

                <Campo label="Só disparar se">
                  <Select
                    value={etapa.condicao}
                    onChange={(ev) =>
                      mudarEtapa(etapa.chave, {
                        condicao: ev.target.value as Condicao,
                      })
                    }
                  >
                    {(Object.keys(ROTULO_CONDICAO) as Condicao[]).map((c) => (
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
                      mudarEtapa(etapa.chave, { acao: ev.target.value as AcaoEtapa })
                    }
                  >
                    {(Object.keys(ROTULO_ACAO) as AcaoEtapa[]).map((a) => (
                      <option key={a} value={a}>
                        {ROTULO_ACAO[a]}
                      </option>
                    ))}
                  </Select>
                </Campo>

                {etapa.acao === "enviar_whatsapp" && (
                  <>
                    <Campo
                      label="Mensagem"
                      erro={erroDaEtapa(estado.campos, indiceSelecionada, "mensagem")}
                    >
                      <Textarea
                        ref={areaRef}
                        rows={5}
                        value={etapa.mensagem}
                        onChange={(ev) =>
                          mudarEtapa(etapa.chave, { mensagem: ev.target.value })
                        }
                        placeholder="Oi {{nome}}, tudo bem?"
                      />
                    </Campo>
                    <div className="flex flex-wrap gap-1.5">
                      {VARIAVEIS.map(([chave, descricao]) => (
                        <button
                          key={chave}
                          type="button"
                          title={descricao}
                          onClick={() => inserirVariavel(chave)}
                          className="rounded-md border border-ink-200 bg-ink-50 px-2 py-1 font-mono text-[11px] text-ink-600 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
                        >
                          {`{{${chave}}}`}
                        </button>
                      ))}
                    </div>
                    <Switch
                      ativo={etapa.anexarPix}
                      onChange={(v) => mudarEtapa(etapa.chave, { anexarPix: v })}
                      label="Anexar PIX copia e cola"
                      descricao={
                        config.chavePix
                          ? "Vai junto com a mensagem."
                          : "Você ainda não cadastrou a chave PIX em Ajustes."
                      }
                    />
                  </>
                )}

                <Switch
                  ativo={etapa.ativa}
                  onChange={(v) => mudarEtapa(etapa.chave, { ativa: v })}
                  label="Etapa ligada"
                  descricao="Desligada, ela fica no desenho mas não dispara."
                />
              </div>
            </Card>
          ) : (
            <Card>
              <p className="text-sm text-ink-500">
                Selecione uma etapa na linha do tempo para configurar.
              </p>
            </Card>
          )}

          {!novo && (
            <button
              type="button"
              onClick={() => setConfirmarExclusao(true)}
              className="w-full rounded-xl border border-ink-200 bg-white p-3 text-sm text-ink-500 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
            >
              Arquivar esta régua
            </button>
          )}
        </div>
      </div>

      {simular && (
        <Simulador
          etapas={etapas}
          cobrancas={cobrancas}
          config={config}
          aoFechar={() => setSimular(false)}
        />
      )}

      {confirmarExclusao && regua.id && (
        <ModalArquivar
          id={regua.id}
          nome={regua.nome}
          emAndamento={emAndamento}
          aoFechar={() => setConfirmarExclusao(false)}
        />
      )}
    </form>
  );
}

/* -------------------------------------------------------------- simulador */

function Simulador({
  etapas,
  cobrancas,
  config,
  aoFechar,
}: {
  etapas: EtapaEditavel[];
  cobrancas: CobrancaExemplo[];
  config: ConfigEditor;
  aoFechar: () => void;
}) {
  const [escolhida, setEscolhida] = useState(cobrancas[0]?.id ?? "");
  const cobranca = cobrancas.find((c) => c.id === escolhida) ?? null;

  const plano = useMemo(() => {
    if (!cobranca) return null;
    return materializarDisparos(
      etapas.map((e, i) => ({
        id: e.chave,
        ordem: i + 1,
        referencia: e.referencia,
        offsetDias: e.offsetDias,
        hora: e.hora,
        condicao: e.condicao,
        acao: e.acao,
        ativa: e.ativa,
      })),
      {
        id: cobranca.id,
        vencimento: cobranca.vencimento,
        criadaEm: new Date(cobranca.criadoEm),
        pagoEm: cobranca.pagoEm ? new Date(cobranca.pagoEm) : null,
      },
      {
        fuso: config.fuso,
        horarioInicio: config.horarioInicio,
        horarioFim: config.horarioFim,
        diasSemana: config.diasSemana,
      },
    );
  }, [cobranca, etapas, config]);

  // Um único relógio para a simulação inteira: se cada prévia lesse a hora por
  // conta própria, duas etapas renderizadas na virada do dia mostrariam atrasos
  // diferentes para a mesma cobrança.
  const agora = useMemo(() => new Date().getTime(), []);

  function previa(chave: string): string {
    const etapa = etapas.find((e) => e.chave === chave);
    if (!etapa || !cobranca || etapa.acao !== "enviar_whatsapp") return "";
    const venc = new Date(`${cobranca.vencimento}T12:00:00Z`).getTime();
    const dias = Math.max(0, Math.floor((agora - venc) / 86_400_000));
    return preencherVariaveis(
      etapa.mensagem,
      {
        nomeCompleto: cobranca.cliente,
        valorCentavos: cobranca.valorCentavos,
        vencimento: cobranca.vencimento,
        descricao: cobranca.descricao,
        diasAtraso: dias,
        empresa: config.nomeEmpresa,
        atendente: config.nomeAtendente,
        linkPagamento: config.chavePix,
      },
      { permitirVazias: true },
    );
  }

  return (
    <Modal
      aberto
      largura="max-w-2xl"
      titulo="Simular régua"
      subtitulo="O mesmo cálculo que o robô usa na hora de agendar."
      aoFechar={aoFechar}
    >
      {cobrancas.length === 0 ? (
        <p className="text-sm text-ink-500">
          Você ainda não tem cobranças para simular. Crie uma cobrança e volte
          aqui.
        </p>
      ) : (
        <div className="space-y-4">
          <Campo label="Simular com a cobrança">
            <Select
              value={escolhida}
              onChange={(ev) => setEscolhida(ev.target.value)}
            >
              {cobrancas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.cliente} — {brl(centavosParaReais(c.valorCentavos))} (
                  {c.descricao})
                </option>
              ))}
            </Select>
          </Campo>

          <ol className="space-y-3">
            {plano?.disparos.map((d) => (
              <li
                key={d.etapaId}
                className="rounded-xl border border-ink-200 bg-white p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Icon name={ICONE_ACAO[d.acao]} className="size-4 text-ink-500" />
                  <span className="text-sm font-medium text-ink-900">
                    {ROTULO_ACAO[d.acao]}
                  </span>
                  <span className="text-[13px] text-ink-500">
                    {dataHora(d.executarEm.toISOString())}
                  </span>
                  {d.ajustes.includes("expediente") && (
                    <Badge tom="info">adiada para o expediente</Badge>
                  )}
                  {d.condicao !== "sempre" && (
                    <Badge tom="neutro">{ROTULO_CONDICAO[d.condicao]}</Badge>
                  )}
                </div>
                {previa(d.etapaId) && (
                  <p className="mt-2 whitespace-pre-line rounded-lg bg-ink-50 p-2 text-[13px] leading-relaxed text-ink-700">
                    {previa(d.etapaId)}
                  </p>
                )}
              </li>
            ))}
          </ol>

          {plano && plano.disparos.length === 0 && (
            <p className="rounded-xl border border-dashed border-ink-300 p-6 text-center text-sm text-ink-500">
              Nada seria enviado para esta cobrança. Etapas fora da janela ou sem
              data base ficam de fora.
            </p>
          )}

          {plano && plano.descartadas.length > 0 && (
            <p className="text-[13px] text-ink-500">
              {plano.descartadas.length}{" "}
              {plano.descartadas.length === 1 ? "etapa ficou" : "etapas ficaram"} de
              fora: desligada, sem data de referência ainda (pagamento) ou com a
              hora já passada.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

/* --------------------------------------------------------------- arquivar */

function ModalArquivar({
  id,
  nome,
  emAndamento,
  aoFechar,
}: {
  id: string;
  nome: string;
  emAndamento: number;
  aoFechar: () => void;
}) {
  const [estado, acao] = useActionState(arquivarReguaAction, ESTADO_INICIAL);

  return (
    <Modal
      aberto
      titulo="Arquivar régua"
      subtitulo={`"${nome}" some da lista e para de agendar.`}
      aoFechar={aoFechar}
    >
      {/* Formulário próprio: um `<form>` dentro do outro não existe em HTML, e
          esta ação redireciona em vez de salvar o rascunho. */}
      <form action={acao} className="space-y-4">
        <input type="hidden" name="id" value={id} />
        <AvisoForm estado={estado} />
        <p className="text-sm leading-relaxed text-ink-600">
          {emAndamento > 0 ? (
            <>
              <strong>{emAndamento}</strong>{" "}
              {emAndamento === 1 ? "cobrança está" : "cobranças estão"} nesta régua.
              As mensagens ainda não enviadas serão canceladas. O histórico do que
              já saiu continua.
            </>
          ) : (
            "Nenhuma cobrança está correndo nesta régua agora."
          )}
        </p>
        <div className="flex justify-end gap-2">
          <Botao variante="secundario" type="button" onClick={aoFechar}>
            Cancelar
          </Botao>
          <BotaoEnviar variante="perigo" enviando="Arquivando…">
            Arquivar
          </BotaoEnviar>
        </div>
      </form>
    </Modal>
  );
}
