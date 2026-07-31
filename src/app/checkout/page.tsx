"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useApp } from "@/lib/store";
import {
  PERIODOS,
  economiaCom,
  getPeriodo,
  getPlano,
  precoMensalCom,
  precoTotalCom,
} from "@/lib/plans";
import type { PeriodoId, PlanId } from "@/lib/types";
import { Abas, Badge, Botao, Campo, Card, Input, cx } from "@/components/ui";
import { Icon, Logo } from "@/components/icons";
import { brl, dataLonga, numero } from "@/lib/format";

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
          width: 168,
          height: 168,
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

/* ---------------------------------------------------------------- Util */

function ehPlanoValido(v: string | null): v is PlanId {
  return v === "essencial" || v === "profissional" || v === "completo";
}

function ehPeriodoValido(v: string | null): v is PeriodoId {
  return v === "mensal" || v === "semestral" || v === "anual";
}

/* ------------------------------------------------------------- Página */

export default function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-ink-50">
          <p className="text-sm text-ink-400">Carregando checkout...</p>
        </div>
      }
    >
      <ConteudoCheckout />
    </Suspense>
  );
}

function ConteudoCheckout() {
  const app = useApp();
  const router = useRouter();
  const searchParams = useSearchParams();

  const planoParam = searchParams.get("plano");
  const periodoParam = searchParams.get("periodo");

  const planoId: PlanId = ehPlanoValido(planoParam) ? planoParam : "profissional";
  const [periodoId, setPeriodoId] = useState<PeriodoId>(
    ehPeriodoValido(periodoParam) ? periodoParam : "semestral",
  );

  const [abaPagamento, setAbaPagamento] = useState<"pix" | "cartao">("pix");
  const [copiado, setCopiado] = useState(false);
  const [segundosRestantes, setSegundosRestantes] = useState(15 * 60);
  const [confirmando, setConfirmando] = useState(false);
  const [pago, setPago] = useState(false);

  useEffect(() => {
    if (pago) return;
    const t = setInterval(() => {
      setSegundosRestantes((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(t);
  }, [pago]);

  const plano = getPlano(planoId);
  const periodoAtual = getPeriodo(periodoId);
  const precoMensal = precoMensalCom(planoId, periodoId);
  const precoTotal = precoTotalCom(planoId, periodoId);
  const economia = economiaCom(planoId, periodoId);

  const minutos = Math.floor(segundosRestantes / 60)
    .toString()
    .padStart(2, "0");
  const segundos = (segundosRestantes % 60).toString().padStart(2, "0");

  const codigoPix = `00020126580014BR.GOV.BCB.PIX0136autoflow@pix.com.br5204000053039865802BR5913AUTOFLOW LTDA6009SAO PAULO62070503***6304${planoId
    .toUpperCase()
    .slice(0, 4)}${periodoId.toUpperCase().slice(0, 3)}`;

  async function copiarCodigo() {
    try {
      await navigator.clipboard.writeText(codigoPix);
      setCopiado(true);
      app.notificar("Código PIX copiado");
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      app.notificar("Não foi possível copiar. Selecione o código manualmente.", "erro");
    }
  }

  function confirmarPagamento() {
    setConfirmando(true);
    setTimeout(() => {
      app.assinar(planoId, periodoId);
      app.atualizarConta({ onboardingCompleto: true });
      setConfirmando(false);
      setPago(true);
    }, 1200);
  }

  if (pago) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-ink-50 px-4 text-center">
        <div className="w-full max-w-md animate-fade-up rounded-2xl bg-white p-10 shadow-sm">
          <div className="flex flex-col items-center gap-4">
            <span className="flex size-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <Icon name="check" className="size-8" />
            </span>
            <div>
              <h1 className="text-xl font-semibold text-ink-900">
                Pagamento confirmado!
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-ink-600">
                Seu plano <strong>{plano.nome}</strong> está ativo até{" "}
                <strong>{dataLonga(app.conta.expiraEm)}</strong>.
              </p>
            </div>
            {app.logado ? (
              <Botao
                variante="primario"
                tamanho="lg"
                className="w-full"
                iconeDireita="arrowRight"
                onClick={() => router.push("/painel")}
              >
                Ir para o painel
              </Botao>
            ) : (
              <Botao
                variante="primario"
                tamanho="lg"
                className="w-full"
                iconeDireita="arrowRight"
                onClick={() => router.push("/entrar")}
              >
                Entrar para acessar o painel
              </Botao>
            )}
            <p className="text-xs text-ink-400">
              Ambiente de demonstração — nenhuma cobrança real é feita.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink-50 pb-16">
      <div className="mx-auto max-w-5xl px-4 pt-8">
        <div className="mb-6 flex items-center gap-3">
          <Logo className="size-8" />
          <div>
            <p className="text-sm font-semibold text-ink-900">AutoFlow</p>
            <p className="text-xs text-ink-500">Finalizar assinatura</p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <Card className="p-5 sm:p-6">
            <Abas
              abas={[
                { id: "pix" as const, nome: "PIX" },
                { id: "cartao" as const, nome: "Cartão de crédito" },
              ]}
              ativa={abaPagamento}
              aoMudar={setAbaPagamento}
            />

            <div className="mt-5">
              {abaPagamento === "pix" ? (
                <div className="space-y-5">
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold text-ink-900">
                      Pague com PIX
                    </h2>
                    <Badge tom="sucesso">Aprovação na hora</Badge>
                  </div>

                  <div className="flex flex-col items-center gap-4 rounded-xl bg-ink-50 p-5 sm:flex-row sm:items-start">
                    <QrFalso seed={planoId.length * 97 + periodoId.length} />
                    <div className="flex-1 space-y-3">
                      <p className="text-sm text-ink-600">
                        Abra o app do seu banco, escolha pagar via Pix Copia
                        e Cola, ou escaneie o QR Code ao lado.
                      </p>
                      <div className="flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2">
                        <code className="flex-1 truncate text-xs text-ink-600">
                          {codigoPix}
                        </code>
                        <Botao
                          tamanho="sm"
                          variante="secundario"
                          icone={copiado ? "check" : "copy"}
                          onClick={copiarCodigo}
                        >
                          {copiado ? "Copiado" : "Copiar"}
                        </Botao>
                      </div>
                      <div className="flex items-center gap-1.5 text-[13px] text-ink-500">
                        <Icon name="clock" className="size-4" />
                        <span>
                          Esse código expira em{" "}
                          <strong className="text-ink-800">
                            {minutos}:{segundos}
                          </strong>
                        </span>
                      </div>
                    </div>
                  </div>

                  <Botao
                    variante="primario"
                    tamanho="lg"
                    className="w-full"
                    onClick={confirmarPagamento}
                    disabled={confirmando}
                    icone={confirmando ? undefined : "check"}
                  >
                    {confirmando ? "Confirmando pagamento..." : "Já fiz o pagamento"}
                  </Botao>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-700">
                    <Icon name="alert" className="size-4 shrink-0" />
                    Pagamento por cartão disponível na versão final.
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Campo label="Número do cartão">
                      <Input disabled placeholder="•••• •••• •••• ••••" />
                    </Campo>
                    <Campo label="Nome impresso no cartão">
                      <Input disabled placeholder="Como está no cartão" />
                    </Campo>
                    <Campo label="Validade">
                      <Input disabled placeholder="MM/AA" />
                    </Campo>
                    <Campo label="CVV">
                      <Input disabled placeholder="•••" />
                    </Campo>
                  </div>
                  <Botao variante="secundario" tamanho="lg" className="w-full" disabled>
                    Indisponível no momento
                  </Botao>
                </div>
              )}
            </div>
          </Card>

          <Card className="h-fit space-y-5 p-5 lg:sticky lg:top-6">
            <div>
              <p className="text-[13px] font-medium text-ink-500">
                Resumo do pedido
              </p>
              <h3 className="mt-0.5 text-lg font-semibold text-ink-900">
                {plano.nome}
              </h3>
              <p className="text-[13px] text-ink-500">{plano.chamada}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              {PERIODOS.map((p) => {
                const ativo = periodoId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPeriodoId(p.id)}
                    className={cx(
                      "flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] font-medium transition-all",
                      ativo
                        ? "border-brand-600 bg-brand-600 text-white"
                        : "border-ink-200 bg-white text-ink-600 hover:border-ink-300",
                    )}
                  >
                    {p.nome}
                    {p.selo && (
                      <span
                        className={cx(
                          "rounded-full px-1.5 text-[10.5px]",
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

            <div className="space-y-1.5 border-y border-ink-100 py-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-ink-500">Mensalidade equivalente</span>
                <span className="font-medium text-ink-900">
                  {brl(precoMensal)}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-ink-500">
                  Total ({periodoAtual.meses}x)
                </span>
                <span className="font-semibold text-ink-900">
                  {brl(precoTotal)}
                </span>
              </div>
              {economia > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-ink-500">Economia no período</span>
                  <Badge tom="sucesso">{brl(economia)}</Badge>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-[13px] font-medium text-ink-700">
                O que está incluso
              </p>
              <ul className="space-y-1.5">
                {plano.beneficios.map((b) => (
                  <li
                    key={b}
                    className="flex items-start gap-2 text-[13px] text-ink-600"
                  >
                    <Icon
                      name="check"
                      className="mt-0.5 size-3.5 shrink-0 text-emerald-600"
                    />
                    {b}
                  </li>
                ))}
                <li className="flex items-start gap-2 text-[13px] text-ink-600">
                  <Icon
                    name="chat"
                    className="mt-0.5 size-3.5 shrink-0 text-brand-600"
                  />
                  {numero(plano.creditosMes)} mensagens de IA por mês
                </li>
                <li className="flex items-start gap-2 text-[13px] text-ink-600">
                  <Icon
                    name="whatsapp"
                    className="mt-0.5 size-3.5 shrink-0 text-zap"
                  />
                  {plano.conexoesInclusas}{" "}
                  {plano.conexoesInclusas === 1
                    ? "número de WhatsApp incluso"
                    : "números de WhatsApp inclusos"}
                </li>
              </ul>
            </div>
          </Card>
        </div>

        <div className="mt-10 flex flex-col items-center gap-2 text-center">
          <p className="text-xs text-ink-400">
            Ambiente de demonstração — nenhuma cobrança real é feita.
          </p>
          <div className="flex items-center gap-4 text-ink-300">
            <span className="flex items-center gap-1 text-[11px]">
              <Icon name="shield" className="size-3.5" /> Pagamento simulado
            </span>
            <span className="flex items-center gap-1 text-[11px]">
              <Icon name="lock" className="size-3.5" /> Dados protegidos
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
