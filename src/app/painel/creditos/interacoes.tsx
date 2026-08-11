"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { AvisoForm, BotaoEnviar } from "@/components/form";
import { Icon } from "@/components/icons";
import { Badge, Botao, Modal, Switch } from "@/components/ui";
import { cx } from "@/lib/cx";
import { brl } from "@/lib/format";
import { ESTADO_INICIAL } from "@/lib/form";
import {
  contratarPlanoAction,
  definirRenovacaoAction,
} from "@/server/actions/creditos";
import type { PlanoCatalogo } from "@/server/dal/creditos";
import { centavosParaReais } from "@/server/dominio/dinheiro";

/**
 * As partes de Plano que precisam de browser.
 *
 * O protótipo trocava o plano no clique (`app.assinar`), sem pagamento de
 * verdade. Aqui a ação cria um pagamento pendente e quem libera é o webhook
 * do provedor — por isso o sucesso não fecha o modal, ele mostra que falta
 * pagar o PIX.
 */

const NOME_PERIODO: Record<string, string> = {
  mensal: "Mensal",
  semestral: "Semestral",
  anual: "Anual",
};

/** Preço de um plano na periodicidade escolhida (centavos). */
function precoDe(plano: PlanoCatalogo, periodicidade: string) {
  return (
    plano.precos.find((p) => p.periodicidade === periodicidade) ?? plano.precos[0]
  );
}

/**
 * Leva ao PIX que a ação acabou de criar.
 *
 * A action devolve o `pagamentoId` em vez de redirecionar: `redirect()` dentro
 * de um `useActionState` viraria erro engolido pelo `catch` que monta o estado.
 * Some quando o provedor não devolveu id — aí não há o que abrir.
 */
function LinkPagamento({
  pagamentoId,
  variante = "texto",
}: {
  pagamentoId?: string;
  variante?: "texto" | "botao";
}) {
  if (!pagamentoId) return null;
  const href = `/painel/checkout/${pagamentoId}`;

  if (variante === "botao") {
    return (
      <Link href={href}>
        <Botao icone="pix">Pagar com PIX</Botao>
      </Link>
    );
  }
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 text-[13px] font-medium text-brand-700 hover:underline"
    >
      <Icon name="pix" className="size-3.5" />
      Abrir o PIX deste pagamento
    </Link>
  );
}

/* ------------------------------------------------------------ Mudar plano */

export function BotaoMudarPlano({
  catalogo,
  planoAtualId,
  periodicidadeAtual,
  planoSugerido,
  rotulo = "Mudar de plano",
  variante = "secundario",
}: {
  catalogo: PlanoCatalogo[];
  planoAtualId: string | null;
  periodicidadeAtual: string | null;
  planoSugerido: string | null;
  rotulo?: string;
  variante?: "primario" | "secundario";
}) {
  /*
   * `planoSugerido` vem do `?plano=` que a tela de feature bloqueada monta.
   * Abrir já no plano certo evita que quem clicou em "fazer upgrade" tenha de
   * procurar de novo qual plano destrava o que ele queria.
   */
  const [aberto, setAberto] = useState(Boolean(planoSugerido));

  return (
    <>
      <Botao variante={variante} tamanho="sm" onClick={() => setAberto(true)}>
        {rotulo}
      </Botao>
      <ModalMudarPlano
        aberto={aberto}
        aoFechar={() => setAberto(false)}
        catalogo={catalogo}
        planoAtualId={planoAtualId}
        periodicidadeAtual={periodicidadeAtual}
        planoSugerido={planoSugerido}
      />
    </>
  );
}

function ModalMudarPlano({
  aberto,
  aoFechar,
  catalogo,
  planoAtualId,
  periodicidadeAtual,
  planoSugerido,
}: {
  aberto: boolean;
  aoFechar: () => void;
  catalogo: PlanoCatalogo[];
  planoAtualId: string | null;
  periodicidadeAtual: string | null;
  planoSugerido: string | null;
}) {
  const [estado, acao] = useActionState(contratarPlanoAction, ESTADO_INICIAL);
  const padrao =
    catalogo.find((p) => p.id === planoSugerido) ??
    catalogo.find((p) => p.id === planoAtualId) ??
    catalogo.find((p) => p.destaque) ??
    catalogo[0];
  const [planoSel, setPlanoSel] = useState(padrao?.id ?? "");
  const [periodoSel, setPeriodoSel] = useState(periodicidadeAtual ?? "mensal");

  const plano = catalogo.find((p) => p.id === planoSel) ?? padrao;
  if (!plano) return null;

  const preco = precoDe(plano, periodoSel);
  /* Economia contra pagar o mesmo plano mês a mês — o desconto real do combo. */
  const economia = plano.precoMensal * preco.meses - preco.precoTotal;
  const periodos = plano.precos;

  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      titulo="Mudar de plano"
      subtitulo="Escolha o plano e o período de cobrança"
      largura="max-w-2xl"
    >
      {estado.ok ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl bg-emerald-50 p-4 ring-1 ring-emerald-200 ring-inset">
            <Icon name="pix" className="mt-0.5 size-4 shrink-0 text-emerald-600" />
            <div className="text-[13px] leading-relaxed text-emerald-800">
              <p>{estado.mensagem}</p>
              <p className="mt-1 text-emerald-700">
                O plano novo entra assim que o pagamento for confirmado. Nada é
                cobrado duas vezes: o que sobrou do período atual vira desconto.
              </p>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Botao variante="secundario" onClick={aoFechar}>
              Fechar
            </Botao>
            <LinkPagamento
              pagamentoId={estado.valores?.pagamentoId}
              variante="botao"
            />
          </div>
        </div>
      ) : (
        <form action={acao} className="space-y-5">
          <AvisoForm estado={estado} />
          <input type="hidden" name="planoId" value={plano.id} />
          <input type="hidden" name="periodicidade" value={periodoSel} />

          <div className="flex gap-1 rounded-xl bg-ink-100 p-1">
            {periodos.map((p) => (
              <button
                key={p.periodicidade}
                type="button"
                onClick={() => setPeriodoSel(p.periodicidade)}
                className={cx(
                  "relative flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-all",
                  periodoSel === p.periodicidade
                    ? "bg-white text-ink-900 shadow-sm"
                    : "text-ink-500 hover:text-ink-800",
                )}
              >
                {NOME_PERIODO[p.periodicidade] ?? p.periodicidade}
                {p.descontoBp > 0 && (
                  <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                    -{Math.round(p.descontoBp / 100)}%
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {catalogo.map((p) => {
              const ativo = planoSel === p.id;
              const pr = precoDe(p, periodoSel);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPlanoSel(p.id)}
                  className={cx(
                    "flex flex-col items-start rounded-2xl border p-4 text-left transition-all",
                    ativo
                      ? "border-brand-500 bg-brand-50/60 ring-2 ring-brand-500/20"
                      : "border-ink-200 hover:border-ink-300",
                  )}
                >
                  <div className="flex w-full items-center justify-between">
                    <span className="text-sm font-semibold text-ink-900">
                      {p.nome}
                    </span>
                    {p.id === planoAtualId ? (
                      <Badge tom="sucesso">Atual</Badge>
                    ) : (
                      p.destaque && <Badge tom="marca">Popular</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-lg font-semibold text-ink-900">
                    {brl(centavosParaReais(pr.precoMensalEquivalente))}
                    <span className="text-xs font-normal text-ink-500">/mês</span>
                  </p>
                  {p.chamada && (
                    <p className="mt-2 text-xs leading-relaxed text-ink-500">
                      {p.chamada}
                    </p>
                  )}
                </button>
              );
            })}
          </div>

          <div className="rounded-xl bg-ink-50 p-4 text-[13px]">
            <div className="flex items-center justify-between">
              <span className="text-ink-500">Equivalente mensal</span>
              <span className="font-semibold text-ink-900">
                {brl(centavosParaReais(preco.precoMensalEquivalente))}/mês
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-ink-500">Total do período</span>
              <span className="font-semibold text-ink-900">
                {brl(centavosParaReais(preco.precoTotal))}
              </span>
            </div>
            {economia > 0 && (
              <div className="mt-1 flex items-center justify-between text-emerald-700">
                <span>Você economiza</span>
                <span className="font-semibold">
                  {brl(centavosParaReais(economia))}
                </span>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Botao type="button" variante="fantasma" onClick={aoFechar}>
              Cancelar
            </Botao>
            <BotaoEnviar icone="pix" enviando="Gerando PIX...">
              Pagar {plano.nome} — {brl(centavosParaReais(preco.precoTotal))}
            </BotaoEnviar>
          </div>
        </form>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------ Renovação do plano */

export function SwitchRenovacao({ ativa }: { ativa: boolean }) {
  const [estado, acao] = useActionState(definirRenovacaoAction, ESTADO_INICIAL);
  const form = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={form}
      action={acao}
      className="rounded-xl border border-ink-200 p-4"
    >
      {/*
       * O hidden carrega o valor *novo*: ler o estado do Switch no submit daria
       * o valor antigo, porque o React ainda não repintou quando o requestSubmit
       * roda.
       */}
      <input type="hidden" name="automatica" value={ativa ? "false" : "true"} />
      <ControleRenovacao
        ativa={ativa}
        aoMudar={() => form.current?.requestSubmit()}
      />
      {(estado.erro ?? (estado.ok ? estado.mensagem : undefined)) && (
        <p
          className={cx(
            "mt-2.5 text-[13px]",
            estado.erro ? "text-rose-600" : "text-emerald-700",
          )}
        >
          {estado.erro ?? estado.mensagem}
        </p>
      )}
    </form>
  );
}

function ControleRenovacao({
  ativa,
  aoMudar,
}: {
  ativa: boolean;
  aoMudar: () => void;
}) {
  const { pending } = useFormStatus();
  return (
    <Switch
      /* Enquanto envia, mostra o destino: o toggle não pode parecer travado. */
      ativo={pending ? !ativa : ativa}
      onChange={aoMudar}
      disabled={pending}
      label="Renovação automática"
      descricao="Desligando, seu acesso continua até o fim do período já pago e nada é cobrado depois."
    />
  );
}
