"use client";

import { useState } from "react";
import { Pagina } from "@/components/shell";
import {
  Badge,
  Barra,
  Botao,
  Card,
  CardTitulo,
  Modal,
  Switch,
  cx,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import { useApp } from "@/lib/store";
import {
  PACOTES_CREDITO,
  PERIODOS,
  PLANOS,
  economiaCom,
  getPeriodo,
  getPlano,
  precoMensalCom,
  precoTotalCom,
} from "@/lib/plans";
import { brl, dataLonga, diasAte, numero } from "@/lib/format";
import type { PeriodoId, PlanId, Transacao } from "@/lib/types";

export default function CreditosPage() {
  return (
    <Pagina
      titulo="Plano e créditos"
      descricao="Sua assinatura, o consumo de mensagens de IA e o histórico de pagamentos."
    >
      <div className="space-y-6">
        <BlocoPlano />
        <BlocoCreditos />
        <BlocoFaturas />
      </div>
    </Pagina>
  );
}

/* --------------------------------------------------------------- Plano */

function BlocoPlano() {
  const app = useApp();
  const [modalAberto, setModalAberto] = useState(false);
  const plano = getPlano(app.conta.planoId);
  const periodo = getPeriodo(app.conta.periodo);
  const diasParaExpirar = diasAte(app.conta.expiraEm);

  return (
    <Card>
      <CardTitulo
        titulo="Seu plano"
        subtitulo="O que está incluso na sua assinatura"
        acao={
          <Botao variante="secundario" tamanho="sm" onClick={() => setModalAberto(true)}>
            Mudar de plano
          </Botao>
        }
      />
      <div className="grid gap-6 p-5 md:grid-cols-[1.1fr_1fr]">
        <div className="rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50 to-white p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-brand-600">
                Plano atual
              </p>
              <p className="mt-1 text-xl font-semibold text-ink-900">
                {plano.nome}
                <span className="ml-2 text-sm font-normal text-ink-500">
                  · {periodo.nome}
                </span>
              </p>
            </div>
            {plano.destaque && <Badge tom="marca">Mais popular</Badge>}
          </div>
          <p className="mt-3 text-2xl font-semibold text-ink-900">
            {brl(precoMensalCom(plano.id, periodo.id))}
            <span className="text-sm font-normal text-ink-500">/mês</span>
          </p>
          <p className="mt-1 text-[13px] text-ink-500">
            {brl(precoTotalCom(plano.id, periodo.id))} cobrado a cada {periodo.meses}{" "}
            {periodo.meses === 1 ? "mês" : "meses"}
          </p>
          <p className="mt-3 text-[13px] text-ink-600">
            Expira em <strong className="font-medium">{dataLonga(app.conta.expiraEm)}</strong>
            {diasParaExpirar >= 0 && ` — faltam ${diasParaExpirar} dias`}
          </p>
        </div>
        <div>
          <p className="mb-2 text-[13px] font-medium text-ink-700">O que está incluso</p>
          <ul className="space-y-1.5">
            {plano.beneficios.map((b) => (
              <li key={b} className="flex items-start gap-2 text-[13px] text-ink-600">
                <Icon name="check" className="mt-0.5 size-3.5 shrink-0 text-brand-600" />
                {b}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <ModalMudarPlano aberto={modalAberto} aoFechar={() => setModalAberto(false)} />
    </Card>
  );
}

function ModalMudarPlano({ aberto, aoFechar }: { aberto: boolean; aoFechar: () => void }) {
  const app = useApp();
  const [planoSel, setPlanoSel] = useState<PlanId>(app.conta.planoId);
  const [periodoSel, setPeriodoSel] = useState<PeriodoId>(app.conta.periodo);

  const mensal = precoMensalCom(planoSel, periodoSel);
  const total = precoTotalCom(planoSel, periodoSel);
  const economia = economiaCom(planoSel, periodoSel);

  function confirmar() {
    app.assinar(planoSel, periodoSel);
    app.notificar(`Plano ${getPlano(planoSel).nome} ativado com sucesso.`);
    aoFechar();
  }

  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      titulo="Mudar de plano"
      subtitulo="Escolha o plano e o período de cobrança"
      largura="max-w-2xl"
      rodape={
        <>
          <Botao variante="fantasma" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao onClick={confirmar} icone="check">
            Confirmar {getPlano(planoSel).nome} — {brl(total)}
          </Botao>
        </>
      }
    >
      <div className="mb-5 flex gap-1 rounded-xl bg-ink-100 p-1">
        {PERIODOS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPeriodoSel(p.id)}
            className={cx(
              "relative flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-all",
              periodoSel === p.id ? "bg-white text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-800",
            )}
          >
            {p.nome}
            {p.selo && (
              <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                {p.selo}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {PLANOS.map((p) => {
          const ativo = planoSel === p.id;
          return (
            <button
              key={p.id}
              onClick={() => setPlanoSel(p.id)}
              className={cx(
                "flex flex-col items-start rounded-2xl border p-4 text-left transition-all",
                ativo
                  ? "border-brand-500 bg-brand-50/60 ring-2 ring-brand-500/20"
                  : "border-ink-200 hover:border-ink-300",
              )}
            >
              <div className="flex w-full items-center justify-between">
                <span className="text-sm font-semibold text-ink-900">{p.nome}</span>
                {p.destaque && <Badge tom="marca">Popular</Badge>}
              </div>
              <p className="mt-1 text-lg font-semibold text-ink-900">
                {brl(precoMensalCom(p.id, periodoSel))}
                <span className="text-xs font-normal text-ink-500">/mês</span>
              </p>
              <p className="mt-1 text-xs text-ink-500">
                {numero(p.creditosMes)} mensagens/mês
              </p>
              <p className="mt-2 text-xs leading-relaxed text-ink-500">{p.chamada}</p>
            </button>
          );
        })}
      </div>

      <div className="mt-4 rounded-xl bg-ink-50 p-4 text-[13px]">
        <div className="flex items-center justify-between">
          <span className="text-ink-500">Equivalente mensal</span>
          <span className="font-semibold text-ink-900">{brl(mensal)}/mês</span>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-ink-500">Total do período</span>
          <span className="font-semibold text-ink-900">{brl(total)}</span>
        </div>
        {economia > 0 && (
          <div className="mt-1 flex items-center justify-between text-emerald-700">
            <span>Você economiza</span>
            <span className="font-semibold">{brl(economia)}</span>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ----------------------------------------------------------- Créditos */

function BlocoCreditos() {
  const app = useApp();
  const [recargaAuto, setRecargaAuto] = useState(false);

  const consumoAtendimento = app.uso.reduce((s, u) => s + u.atendimento, 0);
  const consumoCobranca = app.uso.reduce((s, u) => s + u.cobranca, 0);
  const consumoAgendamento = app.uso.reduce((s, u) => s + u.agendamento, 0);
  const consumoTotal = consumoAtendimento + consumoCobranca + consumoAgendamento;

  function comprar(pacoteId: string) {
    const pacote = PACOTES_CREDITO.find((p) => p.id === pacoteId);
    app.comprarCreditos(pacoteId);
    app.notificar(
      pacote
        ? `${numero(pacote.creditos)} mensagens adicionadas com sucesso via PIX.`
        : "Créditos adicionados.",
    );
  }

  return (
    <Card>
      <CardTitulo
        titulo="Créditos de IA"
        subtitulo="Cada resposta da IA consome 1 crédito; sua cota renova todo mês e você pode recarregar quando quiser."
      />
      <div className="space-y-6 p-5">
        <div>
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium text-ink-800">
              {numero(app.creditosRestantes)} restantes
            </span>
            <span className="text-ink-500">{app.percentualUso}% usado este mês</span>
          </div>
          <Barra
            valor={app.percentualUso}
            tom={app.percentualUso > 90 ? "perigo" : app.percentualUso > 70 ? "aviso" : "marca"}
            className="mt-2"
          />

          {consumoTotal > 0 && (
            <div className="mt-4 grid grid-cols-3 gap-3 text-center">
              <QuebraModulo
                nome="Atendimento"
                valor={consumoAtendimento}
                total={consumoTotal}
                cor="bg-brand-500"
              />
              <QuebraModulo
                nome="Cobrança"
                valor={consumoCobranca}
                total={consumoTotal}
                cor="bg-amber-400"
              />
              <QuebraModulo
                nome="Agendamento"
                valor={consumoAgendamento}
                total={consumoTotal}
                cor="bg-sky-400"
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between rounded-xl border border-ink-200 p-4">
          <Switch
            ativo={recargaAuto}
            onChange={(v) => {
              setRecargaAuto(v);
              app.notificar(
                v
                  ? "Recarga automática marcada. Disponível na versão final."
                  : "Recarga automática desmarcada.",
                "info",
              );
            }}
            label="Recarga automática quando faltar 10%"
            descricao="A gente compra o menor pacote pra você não ficar sem créditos."
          />
        </div>

        <div>
          <p className="mb-3 text-[13px] font-medium text-ink-700">Pacotes de recarga</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {PACOTES_CREDITO.map((pac) => {
              const precoPorMsg = pac.preco / pac.creditos;
              return (
                <div
                  key={pac.id}
                  className="flex flex-col rounded-2xl border border-ink-200 p-4"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-ink-900">
                      {numero(pac.creditos)} mensagens
                    </span>
                    {pac.selo && <Badge tom="marca">{pac.selo}</Badge>}
                  </div>
                  <p className="mt-2 text-xl font-semibold text-ink-900">{brl(pac.preco)}</p>
                  <p className="text-xs text-ink-500">
                    {precoPorMsg.toLocaleString("pt-BR", {
                      style: "currency",
                      currency: "BRL",
                      minimumFractionDigits: 3,
                      maximumFractionDigits: 3,
                    })}{" "}
                    por mensagem
                  </p>
                  <Botao
                    variante="zap"
                    tamanho="sm"
                    icone="pix"
                    className="mt-3"
                    onClick={() => comprar(pac.id)}
                  >
                    Comprar com PIX
                  </Botao>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}

function QuebraModulo({
  nome,
  valor,
  total,
  cor,
}: {
  nome: string;
  valor: number;
  total: number;
  cor: string;
}) {
  const pct = total > 0 ? Math.round((valor / total) * 100) : 0;
  return (
    <div className="rounded-xl bg-ink-50 p-3">
      <span className={cx("mx-auto mb-1.5 block size-2.5 rounded-full", cor)} />
      <p className="text-sm font-semibold text-ink-900">{numero(valor)}</p>
      <p className="text-[11px] text-ink-500">
        {nome} · {pct}%
      </p>
    </div>
  );
}

/* ------------------------------------------------------------ Faturas */

const TIPO_TOM: Record<Transacao["tipo"], "marca" | "info" | "neutro"> = {
  assinatura: "marca",
  creditos: "info",
  conexao: "neutro",
};

const TIPO_NOME: Record<Transacao["tipo"], string> = {
  assinatura: "Assinatura",
  creditos: "Créditos",
  conexao: "Conexão extra",
};

function BlocoFaturas() {
  const app = useApp();

  return (
    <Card>
      <CardTitulo titulo="Faturas" subtitulo="Histórico de pagamentos da sua conta" />
      {app.transacoes.length === 0 ? (
        <div className="p-5 text-sm text-ink-500">Nenhuma fatura ainda.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-ink-100 text-xs text-ink-400">
                <th className="px-5 py-3 font-medium">Descrição</th>
                <th className="px-5 py-3 font-medium">Tipo</th>
                <th className="px-5 py-3 font-medium">Data</th>
                <th className="px-5 py-3 font-medium">Método</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 text-right font-medium">Valor</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {app.transacoes.map((t) => (
                <tr key={t.id} className="border-b border-ink-50 last:border-0">
                  <td className="px-5 py-3 text-ink-800">{t.descricao}</td>
                  <td className="px-5 py-3">
                    <Badge tom={TIPO_TOM[t.tipo]}>{TIPO_NOME[t.tipo]}</Badge>
                  </td>
                  <td className="px-5 py-3 text-ink-500">{dataLonga(t.data)}</td>
                  <td className="px-5 py-3 text-ink-500">
                    <span className="inline-flex items-center gap-1.5">
                      <Icon
                        name={t.metodo === "pix" ? "pix" : "card"}
                        className="size-3.5 text-ink-400"
                      />
                      {t.metodo === "pix" ? "PIX" : "Cartão"}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <Badge tom={t.status === "pago" ? "sucesso" : "aviso"}>
                      {t.status === "pago" ? "Pago" : "Pendente"}
                    </Badge>
                  </td>
                  <td className="px-5 py-3 text-right font-medium text-ink-900">
                    {brl(t.valor)}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Botao
                      variante="fantasma"
                      tamanho="sm"
                      icone="copy"
                      onClick={() => app.notificar("Recibo enviado para o seu e-mail.", "info")}
                    >
                      Baixar recibo
                    </Botao>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
