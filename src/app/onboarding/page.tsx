"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/store";
import {
  FEATURES,
  PERIODOS,
  PLANOS,
  SEGMENTOS,
  TONS,
  economiaCom,
  precoMensalCom,
  precoTotalCom,
} from "@/lib/plans";
import type { FeatureKey, PeriodoId, PlanId } from "@/lib/types";
import {
  Badge,
  Barra,
  Botao,
  Campo,
  Card,
  Input,
  Select,
  cx,
} from "@/components/ui";
import { Icon, Logo, type IconName } from "@/components/icons";
import { brl } from "@/lib/format";

const TOTAL_PASSOS = 5;
const NOMES_PASSO = [
  "Seu negócio",
  "Sua atendente virtual",
  "O que automatizar",
  "Escolha seu plano",
  "Conectar WhatsApp",
];

/* ------------------------------------------------------- QR Code falso */

const TAMANHO_QR = 21;

function celulaAtiva(seed: number, i: number): boolean {
  let h = (seed + i * 2654435761) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489917);
  h ^= h >>> 16;
  return (h & 1) === 1;
}

function aplicarOlho(grade: boolean[][], baseR: number, baseC: number) {
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const borda = r === 0 || r === 6 || c === 0 || c === 6;
      const miolo = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      grade[baseR + r][baseC + c] = borda || miolo;
    }
  }
}

function gerarGradeQR(seed: number): boolean[][] {
  const grade: boolean[][] = [];
  for (let r = 0; r < TAMANHO_QR; r++) {
    const linha: boolean[] = [];
    for (let c = 0; c < TAMANHO_QR; c++) {
      linha.push(celulaAtiva(seed, r * TAMANHO_QR + c));
    }
    grade.push(linha);
  }
  aplicarOlho(grade, 0, 0);
  aplicarOlho(grade, 0, TAMANHO_QR - 7);
  aplicarOlho(grade, TAMANHO_QR - 7, 0);
  return grade;
}

function QrFalso({ seed, className }: { seed: number; className?: string }) {
  const grade = useMemo(() => gerarGradeQR(seed), [seed]);
  return (
    <div
      className={cx(
        "inline-block rounded-xl border border-ink-200 bg-white p-3",
        className,
      )}
    >
      <div
        className="grid overflow-hidden rounded"
        style={{
          gridTemplateColumns: `repeat(${TAMANHO_QR}, 1fr)`,
          width: 200,
          height: 200,
        }}
      >
        {grade.map((linha, r) =>
          linha.map((ativa, c) => (
            <div
              key={`${r}-${c}`}
              className={ativa ? "bg-ink-950" : "bg-white"}
            />
          )),
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- Wizard */

export default function OnboardingPage() {
  const app = useApp();
  const router = useRouter();

  const [passo, setPasso] = useState(1);

  // passo 1 — negócio
  const [nomeEmpresa, setNomeEmpresa] = useState("");
  const [segmento, setSegmento] = useState("");
  const [horarioAtendimento, setHorarioAtendimento] = useState("");

  // passo 2 — atendente
  const [nomeAtendente, setNomeAtendente] = useState("Sofia");
  const [tom, setTom] = useState<string>(TONS[0].id);

  // passo 3 — objetivos
  const [objetivos, setObjetivos] = useState<FeatureKey[]>(["atendimento"]);

  // passo 4 — plano
  const [planoManual, setPlanoManual] = useState<PlanId | null>(null);
  const [periodo, setPeriodo] = useState<PeriodoId>("semestral");

  // passo 5 — conexão
  const [estadoConexao, setEstadoConexao] = useState<
    "aguardando" | "conectando" | "conectada"
  >("aguardando");

  const planoRecomendado = useMemo(() => {
    return (
      PLANOS.find((p) => objetivos.every((o) => p.features.includes(o))) ??
      PLANOS[PLANOS.length - 1]
    );
  }, [objetivos]);

  const planoId: PlanId = planoManual ?? planoRecomendado.id;

  useEffect(() => {
    if (estadoConexao !== "conectando") return;
    const t = setTimeout(() => setEstadoConexao("conectada"), 1500);
    return () => clearTimeout(t);
  }, [estadoConexao]);

  function alternarObjetivo(f: FeatureKey) {
    setObjetivos((prev) =>
      prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f],
    );
  }

  const podeAvancar =
    passo === 1
      ? nomeEmpresa.trim() !== "" &&
        segmento !== "" &&
        horarioAtendimento.trim() !== ""
      : passo === 2
        ? nomeAtendente.trim() !== ""
        : passo === 3
          ? objetivos.length > 0
          : true;

  function avancar() {
    if (passo < TOTAL_PASSOS) setPasso((p) => p + 1);
  }
  function voltar() {
    if (passo > 1) setPasso((p) => p - 1);
  }

  function finalizar() {
    app.atualizarConta({
      nomeEmpresa,
      segmento,
      horarioAtendimento,
      nomeAtendente,
      tom,
      objetivos,
      planoId,
      periodo,
      onboardingCompleto: true,
    });
    router.push(`/checkout?plano=${planoId}&periodo=${periodo}`);
  }

  return (
    <div className="min-h-screen bg-ink-50 px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Logo className="size-10" />
          <p className="text-sm font-medium text-ink-500">
            Passo {passo} de {TOTAL_PASSOS} · {NOMES_PASSO[passo - 1]}
          </p>
          <Barra valor={(passo / TOTAL_PASSOS) * 100} className="w-full" />
        </div>

        <Card className="p-6 sm:p-8">
          {passo === 1 && (
            <div className="space-y-5">
              <div>
                <h1 className="text-lg font-semibold text-ink-900">
                  Conte sobre o seu negócio
                </h1>
                <p className="mt-1 text-sm text-ink-500">
                  Isso ajuda a IA a se apresentar do jeito certo pros seus
                  clientes.
                </p>
              </div>
              <Campo label="Nome da empresa" obrigatorio>
                <Input
                  value={nomeEmpresa}
                  onChange={(e) => setNomeEmpresa(e.target.value)}
                  placeholder="Ex: Clínica Vitalis"
                />
              </Campo>
              <Campo label="Segmento" obrigatorio>
                <Select
                  value={segmento}
                  onChange={(e) => setSegmento(e.target.value)}
                >
                  <option value="">Selecione...</option>
                  {SEGMENTOS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </Campo>
              <Campo label="Horário de atendimento" obrigatorio>
                <Input
                  value={horarioAtendimento}
                  onChange={(e) => setHorarioAtendimento(e.target.value)}
                  placeholder="Seg a Sex, 08h às 19h"
                />
              </Campo>
            </div>
          )}

          {passo === 2 && (
            <div className="space-y-5">
              <div>
                <h1 className="text-lg font-semibold text-ink-900">
                  Sua atendente virtual
                </h1>
                <p className="mt-1 text-sm text-ink-500">
                  Esse é o nome que aparece pro seu cliente quando a IA
                  responde no WhatsApp.
                </p>
              </div>
              <Campo label="Nome da atendente" obrigatorio>
                <Input
                  value={nomeAtendente}
                  onChange={(e) => setNomeAtendente(e.target.value)}
                  placeholder="Sofia"
                />
              </Campo>
              <div>
                <span className="mb-2 block text-[13px] font-medium text-ink-700">
                  Tom de voz
                </span>
                <div className="grid gap-3 sm:grid-cols-3">
                  {TONS.map((t) => {
                    const ativo = tom === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setTom(t.id)}
                        className={cx(
                          "flex flex-col gap-2 rounded-xl border p-3 text-left transition-all",
                          ativo
                            ? "border-brand-500 bg-brand-50/60 ring-2 ring-brand-500/20"
                            : "border-ink-200 hover:border-ink-300",
                        )}
                      >
                        <span className="flex items-center justify-between">
                          <span className="text-[13px] font-semibold text-ink-800">
                            {t.nome}
                          </span>
                          {ativo && (
                            <Icon
                              name="check"
                              className="size-4 text-brand-600"
                            />
                          )}
                        </span>
                        <span className="inline-block rounded-2xl rounded-tl-sm bg-[#d9fdd3] px-3 py-2 text-[12.5px] leading-snug text-ink-800">
                          {t.exemplo}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {passo === 3 && (
            <div className="space-y-5">
              <div>
                <h1 className="text-lg font-semibold text-ink-900">
                  O que você quer automatizar?
                </h1>
                <p className="mt-1 text-sm text-ink-500">
                  Pode marcar mais de um. Dá pra mudar depois no painel.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {(Object.keys(FEATURES) as FeatureKey[]).map((chave) => {
                  const f = FEATURES[chave];
                  const ativo = objetivos.includes(chave);
                  return (
                    <button
                      key={chave}
                      type="button"
                      onClick={() => alternarObjetivo(chave)}
                      className={cx(
                        "flex flex-col gap-2 rounded-xl border p-4 text-left transition-all",
                        ativo
                          ? "border-brand-500 bg-brand-50/60 ring-2 ring-brand-500/20"
                          : "border-ink-200 hover:border-ink-300",
                      )}
                    >
                      <span className="flex items-center justify-between">
                        <span
                          className={cx(
                            "rounded-lg p-2",
                            ativo
                              ? "bg-brand-600 text-white"
                              : "bg-ink-100 text-ink-500",
                          )}
                        >
                          <Icon
                            name={f.icone as IconName}
                            className="size-4"
                          />
                        </span>
                        {ativo && (
                          <Icon
                            name="check"
                            className="size-4 text-brand-600"
                          />
                        )}
                      </span>
                      <span className="text-[13px] font-semibold text-ink-800">
                        {f.nome}
                      </span>
                      <span className="text-xs leading-relaxed text-ink-500">
                        {f.descricao}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2 rounded-xl bg-brand-50 px-4 py-3 text-[13px] text-brand-800">
                <Icon name="spark" className="size-4 shrink-0" />
                <span>
                  Com essa combinação, o plano indicado é{" "}
                  <strong>{planoRecomendado.nome}</strong>.
                </span>
              </div>
            </div>
          )}

          {passo === 4 && (
            <div className="space-y-5">
              <div>
                <h1 className="text-lg font-semibold text-ink-900">
                  Escolha seu plano
                </h1>
                <p className="mt-1 text-sm text-ink-500">
                  Você pode trocar de plano quando quiser, direto no painel.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {PERIODOS.map((p) => {
                  const ativo = periodo === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPeriodo(p.id)}
                      className={cx(
                        "flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-all",
                        ativo
                          ? "border-brand-600 bg-brand-600 text-white"
                          : "border-ink-200 bg-white text-ink-600 hover:border-ink-300",
                      )}
                    >
                      {p.nome}
                      {p.selo && (
                        <span
                          className={cx(
                            "rounded-full px-1.5 text-[11px]",
                            ativo
                              ? "bg-white/20"
                              : "bg-emerald-50 text-emerald-700",
                          )}
                        >
                          {p.selo}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {PLANOS.map((p) => {
                  const ativo = planoId === p.id;
                  const recomendado = p.id === planoRecomendado.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPlanoManual(p.id)}
                      className={cx(
                        "relative flex flex-col gap-1.5 rounded-xl border p-4 pt-5 text-left transition-all",
                        ativo
                          ? "border-brand-500 bg-brand-50/60 ring-2 ring-brand-500/20"
                          : "border-ink-200 hover:border-ink-300",
                      )}
                    >
                      {recomendado && (
                        <Badge
                          tom="marca"
                          className="absolute -top-2.5 left-3"
                        >
                          Recomendado
                        </Badge>
                      )}
                      {ativo && (
                        <Icon
                          name="check"
                          className="absolute right-3 top-3 size-4 text-brand-600"
                        />
                      )}
                      <span className="text-[13px] font-semibold text-ink-800">
                        {p.nome}
                      </span>
                      <span className="text-xs text-ink-500">
                        {p.chamada}
                      </span>
                      <span className="mt-1 text-xl font-semibold text-ink-900">
                        {brl(precoMensalCom(p.id, periodo))}
                        <span className="text-xs font-normal text-ink-400">
                          /mês
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-ink-50 px-4 py-3 text-sm">
                <span className="text-ink-600">
                  Total no período:{" "}
                  <strong className="text-ink-900">
                    {brl(precoTotalCom(planoId, periodo))}
                  </strong>
                </span>
                {economiaCom(planoId, periodo) > 0 && (
                  <Badge tom="sucesso">
                    Economize {brl(economiaCom(planoId, periodo))}
                  </Badge>
                )}
              </div>
            </div>
          )}

          {passo === 5 && (
            <div className="space-y-5">
              <div>
                <h1 className="text-lg font-semibold text-ink-900">
                  Conectar seu WhatsApp
                </h1>
                <p className="mt-1 text-sm text-ink-500">
                  {nomeAtendente || "Sua atendente"} só começa a responder
                  depois de conectar o número.
                </p>
              </div>

              <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start sm:justify-center">
                <div className="relative">
                  <QrFalso seed={42} />
                  {estadoConexao === "conectada" && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/90">
                      <span className="flex flex-col items-center gap-2">
                        <span className="flex size-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                          <Icon name="check" className="size-6" />
                        </span>
                        <span className="text-sm font-semibold text-emerald-700">
                          Conectado!
                        </span>
                      </span>
                    </div>
                  )}
                </div>

                <ol className="max-w-xs space-y-2.5 text-[13px] text-ink-600">
                  <li className="flex gap-2">
                    <span className="font-semibold text-ink-900">1.</span>{" "}
                    Abra o WhatsApp no seu celular
                  </li>
                  <li className="flex gap-2">
                    <span className="font-semibold text-ink-900">2.</span>{" "}
                    Toque em Mais opções (ou Ajustes, no iPhone)
                  </li>
                  <li className="flex gap-2">
                    <span className="font-semibold text-ink-900">3.</span>{" "}
                    Toque em Aparelhos conectados
                  </li>
                  <li className="flex gap-2">
                    <span className="font-semibold text-ink-900">4.</span>{" "}
                    Toque em Conectar aparelho
                  </li>
                  <li className="flex gap-2">
                    <span className="font-semibold text-ink-900">5.</span>{" "}
                    Aponte a câmera para este QR Code
                  </li>
                </ol>
              </div>

              <div className="flex flex-col items-center gap-3 pt-2">
                {estadoConexao === "conectada" ? (
                  <Badge tom="sucesso" icone="check">
                    WhatsApp conectado com sucesso
                  </Badge>
                ) : (
                  <Botao
                    variante="zap"
                    tamanho="lg"
                    icone="whatsapp"
                    onClick={() => setEstadoConexao("conectando")}
                    disabled={estadoConexao === "conectando"}
                    className="w-full sm:w-auto"
                  >
                    {estadoConexao === "conectando"
                      ? "Conectando..."
                      : "Simular conexão"}
                  </Botao>
                )}

                {estadoConexao === "conectada" ? (
                  <Botao
                    variante="primario"
                    onClick={finalizar}
                    iconeDireita="arrowRight"
                  >
                    Concluir configuração
                  </Botao>
                ) : (
                  <button
                    type="button"
                    onClick={finalizar}
                    className="text-[13px] font-medium text-ink-500 underline underline-offset-2 hover:text-ink-700"
                  >
                    Pular por enquanto
                  </button>
                )}
              </div>
            </div>
          )}
        </Card>

        <div className="mt-6 flex items-center justify-between">
          {passo > 1 ? (
            <Botao
              variante="secundario"
              onClick={voltar}
              icone="chevronLeft"
            >
              Voltar
            </Botao>
          ) : (
            <span />
          )}
          {passo < TOTAL_PASSOS && (
            <Botao
              variante="primario"
              onClick={avancar}
              disabled={!podeAvancar}
              iconeDireita="chevronRight"
            >
              Continuar
            </Botao>
          )}
        </div>
      </div>
    </div>
  );
}
