"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Bloqueado, Pagina } from "@/components/shell";
import { Icon } from "@/components/icons";
import {
  Abas,
  Badge,
  Barra,
  Botao,
  Campo,
  Card,
  CardTitulo,
  Input,
  Modal,
  Select,
  Textarea,
  Vazio,
  cx,
} from "@/components/ui";
import { useApp } from "@/lib/store";
import {
  brl,
  corAvatar,
  dataCurta,
  dataHora,
  prazoRelativo,
  telefone,
} from "@/lib/format";
import {
  ICONE_ACAO,
  MODELOS_REGUA,
  ROTULO_ACAO,
  novaRegua,
  proximosDisparos,
  rotuloQuando,
} from "@/lib/regua";
import type { Cobranca, Regua, StatusCobranca } from "@/lib/types";

const TOM_STATUS: Record<
  StatusCobranca,
  "neutro" | "sucesso" | "aviso" | "perigo" | "info"
> = {
  pendente: "aviso",
  pago: "sucesso",
  vencido: "perigo",
  negociando: "info",
  cancelado: "neutro",
};

const NOME_STATUS: Record<StatusCobranca, string> = {
  pendente: "A vencer",
  pago: "Pago",
  vencido: "Vencido",
  negociando: "Negociando",
  cancelado: "Cancelado",
};

type Filtro = "todas" | "aberto" | "vencido" | "pago";

export default function CobrancaPage() {
  const app = useApp();
  if (!app.tem("cobranca")) return <Bloqueado feature="cobranca" />;
  return <Conteudo />;
}

function Conteudo() {
  const app = useApp();
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [busca, setBusca] = useState("");
  const [novaAberta, setNovaAberta] = useState(false);
  const [reguaModelos, setReguaModelos] = useState(false);
  const [detalhe, setDetalhe] = useState<Cobranca | null>(null);

  const { cobrancas, reguas } = app;

  const emAberto = cobrancas.filter(
    (c) => c.status === "pendente" || c.status === "vencido" || c.status === "negociando",
  );
  const vencidas = cobrancas.filter((c) => c.status === "vencido");
  const pagas = cobrancas.filter((c) => c.status === "pago");
  const recuperado = reguas.reduce((s, r) => s + r.stats.recuperado, 0);
  const enviadas = reguas.reduce((s, r) => s + r.stats.enviadas, 0);
  const respondidas = reguas.reduce((s, r) => s + r.stats.respondidas, 0);
  const taxaResposta = enviadas ? Math.round((respondidas / enviadas) * 100) : 0;

  const lista = useMemo(() => {
    const base =
      filtro === "aberto"
        ? emAberto
        : filtro === "vencido"
          ? vencidas
          : filtro === "pago"
            ? pagas
            : cobrancas;
    const termo = busca.trim().toLowerCase();
    return [...base]
      .filter(
        (c) =>
          !termo ||
          c.clienteNome.toLowerCase().includes(termo) ||
          c.descricao.toLowerCase().includes(termo),
      )
      .sort((a, b) => +new Date(a.vencimento) - +new Date(b.vencimento));
  }, [filtro, busca, cobrancas, emAberto, vencidas, pagas]);

  const disparos = useMemo(
    () => proximosDisparos(cobrancas, reguas, 6),
    [cobrancas, reguas],
  );

  return (
    <Pagina
      titulo="Cobrança"
      descricao="A IA lembra, cobra e negocia sozinha. Você só acompanha o dinheiro entrando."
      acao={
        <div className="flex gap-2">
          <Botao
            variante="secundario"
            icone="bolt"
            onClick={() => setReguaModelos(true)}
          >
            Nova régua
          </Botao>
          <Botao icone="plus" onClick={() => setNovaAberta(true)}>
            Nova cobrança
          </Botao>
        </div>
      }
    >
      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-5">
          <p className="text-[13px] font-medium text-ink-500">Em aberto</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-ink-900">
            {brl(emAberto.reduce((s, c) => s + c.valor, 0))}
          </p>
          <p className="mt-1 text-[13px] text-ink-500">
            {emAberto.length} cobrança{emAberto.length === 1 ? "" : "s"} aguardando
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-[13px] font-medium text-ink-500">Vencido</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-rose-600">
            {brl(vencidas.reduce((s, c) => s + c.valor, 0))}
          </p>
          <p className="mt-1 text-[13px] text-ink-500">
            {vencidas.length} em atraso · régua ativa
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-[13px] font-medium text-ink-500">
            Recuperado pela IA
          </p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-emerald-600">
            {brl(recuperado)}
          </p>
          <p className="mt-1 text-[13px] text-ink-500">nos últimos 30 dias</p>
        </Card>
        <Card className="p-5">
          <p className="text-[13px] font-medium text-ink-500">
            Taxa de resposta
          </p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-ink-900">
            {taxaResposta}%
          </p>
          <Barra valor={taxaResposta} tom="marca" className="mt-2.5" />
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-6">
          {/* Réguas */}
          <Card>
            <CardTitulo
              titulo="Réguas de automação"
              subtitulo="A sequência de mensagens que a IA dispara sozinha."
              acao={
                <Botao
                  tamanho="sm"
                  variante="fantasma"
                  icone="plus"
                  onClick={() => setReguaModelos(true)}
                >
                  Criar
                </Botao>
              }
            />
            {reguas.length === 0 ? (
              <Vazio
                icone="bolt"
                titulo="Nenhuma régua criada"
                descricao="Monte a sua sequência de cobrança em 2 minutos ou comece por um modelo pronto."
                acao={
                  <Botao onClick={() => setReguaModelos(true)} icone="plus">
                    Criar minha primeira régua
                  </Botao>
                }
              />
            ) : (
              <ul className="divide-y divide-ink-100">
                {reguas.map((r) => (
                  <CardRegua key={r.id} regua={r} />
                ))}
              </ul>
            )}
          </Card>

          {/* Lista de cobranças */}
          <Card>
            <div className="flex flex-wrap items-center gap-3 border-b border-ink-100 px-5 py-4">
              <div className="relative min-w-[180px] flex-1">
                <Icon
                  name="search"
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400"
                />
                <Input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar cliente ou descrição"
                  className="h-10 pl-9"
                />
              </div>
              <Abas<Filtro>
                abas={[
                  { id: "todas", nome: "Todas", contagem: cobrancas.length },
                  { id: "aberto", nome: "Em aberto", contagem: emAberto.length },
                  { id: "vencido", nome: "Vencidas", contagem: vencidas.length },
                  { id: "pago", nome: "Pagas", contagem: pagas.length },
                ]}
                ativa={filtro}
                aoMudar={setFiltro}
              />
            </div>

            {lista.length === 0 ? (
              <Vazio
                icone="cash"
                titulo="Nada por aqui"
                descricao="Nenhuma cobrança encontrada com esse filtro."
              />
            ) : (
              <ul className="divide-y divide-ink-100">
                {lista.map((c) => {
                  const regua = reguas.find((r) => r.id === c.reguaId);
                  const atrasada = c.status === "vencido";
                  return (
                    <li key={c.id}>
                      <button
                        onClick={() => setDetalhe(c)}
                        className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-ink-50"
                      >
                        <span
                          className={cx(
                            "flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                            corAvatar(c.clienteNome),
                          )}
                        >
                          {c.clienteNome
                            .split(" ")
                            .slice(0, 2)
                            .map((p) => p[0])
                            .join("")}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-ink-900">
                            {c.clienteNome}
                          </p>
                          <p className="truncate text-[13px] text-ink-500">
                            {c.descricao}
                            {regua && (
                              <>
                                {" · "}
                                <span className="text-brand-600">
                                  {regua.nome}
                                </span>
                              </>
                            )}
                          </p>
                        </div>
                        <div className="hidden text-right sm:block">
                          <p
                            className={cx(
                              "text-[13px]",
                              atrasada ? "text-rose-600" : "text-ink-600",
                            )}
                          >
                            {prazoRelativo(c.vencimento)}
                          </p>
                          <p className="text-xs text-ink-400">
                            {dataCurta(c.vencimento)}
                            {c.tentativas > 0 && ` · ${c.tentativas} envios`}
                          </p>
                        </div>
                        <p className="w-24 shrink-0 text-right text-sm font-semibold text-ink-900">
                          {brl(c.valor)}
                        </p>
                        <Badge tom={TOM_STATUS[c.status]} className="shrink-0">
                          {NOME_STATUS[c.status]}
                        </Badge>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        {/* Coluna lateral: fila de disparos */}
        <div className="space-y-6">
          <Card>
            <CardTitulo
              titulo="Próximos disparos"
              subtitulo="O que a IA vai enviar sem você fazer nada."
            />
            {disparos.length === 0 ? (
              <Vazio
                icone="clock"
                titulo="Fila vazia"
                descricao="Ative uma régua para a IA começar a cobrar sozinha."
              />
            ) : (
              <ul className="divide-y divide-ink-100">
                {disparos.map((d, i) => (
                  <li key={`${d.cobranca.id}-${d.etapa.id}-${i}`} className="px-5 py-3">
                    <div className="flex items-start gap-2.5">
                      <span className="mt-0.5 rounded-lg bg-brand-50 p-1.5 text-brand-600">
                        <Icon name={ICONE_ACAO[d.etapa.acao]} className="size-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-ink-800">
                          {d.cobranca.clienteNome}
                        </p>
                        <p className="truncate text-xs text-ink-500">
                          {ROTULO_ACAO[d.etapa.acao]} · {brl(d.cobranca.valor)}
                        </p>
                        <p className="mt-0.5 text-xs text-brand-600">
                          {dataHora(d.quando.toISOString())}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="bg-gradient-to-br from-brand-600 to-brand-800 p-5 text-white">
            <Icon name="spark" className="size-5 opacity-90" />
            <p className="mt-2.5 text-sm font-semibold">
              Cobrar no automático dá resultado
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-brand-100">
              Quem ativa uma régua com PIX na mensagem recupera, em média, 3 de
              cada 4 cobranças atrasadas — sem constrangimento e sem ligação.
            </p>
          </Card>
        </div>
      </div>

      <ModalNovaCobranca aberto={novaAberta} aoFechar={() => setNovaAberta(false)} />
      <ModalModelos aberto={reguaModelos} aoFechar={() => setReguaModelos(false)} />
      <ModalDetalhe cobranca={detalhe} aoFechar={() => setDetalhe(null)} />
    </Pagina>
  );
}

/* ------------------------------------------------------------ Régua item */

function CardRegua({ regua }: { regua: Regua }) {
  const app = useApp();
  const passos = regua.etapas.filter((e) => e.ativa);

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-ink-900">{regua.nome}</p>
            <Badge tom={regua.ativa ? "sucesso" : "neutro"}>
              {regua.ativa ? "Ativa" : "Pausada"}
            </Badge>
          </div>
          <p className="mt-0.5 text-[13px] text-ink-500">
            {regua.descricao || `${passos.length} etapas automáticas`}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Botao
            tamanho="sm"
            variante="fantasma"
            icone={regua.ativa ? "pause" : "play"}
            onClick={() => {
              app.alternarRegua(regua.id);
              app.notificar(
                regua.ativa
                  ? `Régua "${regua.nome}" pausada.`
                  : `Régua "${regua.nome}" ativada.`,
                regua.ativa ? "info" : "sucesso",
              );
            }}
          >
            {regua.ativa ? "Pausar" : "Ativar"}
          </Botao>
          <Link href={`/painel/cobranca/regua/${regua.id}`}>
            <Botao tamanho="sm" variante="secundario" icone="edit">
              Editar
            </Botao>
          </Link>
        </div>
      </div>

      {/* mini timeline */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {passos.map((e, i) => (
          <span key={e.id} className="flex items-center gap-1.5">
            {i > 0 && <Icon name="chevronRight" className="size-3 text-ink-300" />}
            <span
              className="flex items-center gap-1 rounded-lg bg-ink-100 px-2 py-1 text-[11px] font-medium text-ink-600"
              title={rotuloQuando(e)}
            >
              <Icon name={ICONE_ACAO[e.acao]} className="size-3" />
              {e.offsetDias === 0
                ? "no dia"
                : e.offsetDias < 0
                  ? `${Math.abs(e.offsetDias)}d antes`
                  : `${e.offsetDias}d depois`}
            </span>
          </span>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-500">
        <span>
          <strong className="font-semibold text-ink-700">
            {regua.stats.enviadas}
          </strong>{" "}
          enviadas
        </span>
        <span>
          <strong className="font-semibold text-ink-700">
            {regua.stats.respondidas}
          </strong>{" "}
          respostas
        </span>
        <span className="text-emerald-600">
          <strong className="font-semibold">{brl(regua.stats.recuperado)}</strong>{" "}
          recuperados
        </span>
      </div>
    </li>
  );
}

/* ------------------------------------------------------- Modal: modelos */

function ModalModelos({
  aberto,
  aoFechar,
}: {
  aberto: boolean;
  aoFechar: () => void;
}) {
  const app = useApp();
  const router = useRouter();

  function criar(construir: () => Regua) {
    const r = construir();
    app.salvarRegua(r);
    aoFechar();
    router.push(`/painel/cobranca/regua/${r.id}`);
  }

  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      titulo="Como você quer começar?"
      subtitulo="Escolha um modelo pronto e ajuste do seu jeito depois."
    >
      <div className="space-y-2.5">
        {MODELOS_REGUA.map((m) => (
          <button
            key={m.id}
            onClick={() => criar(m.construir)}
            className="flex w-full items-center gap-3 rounded-xl border border-ink-200 p-4 text-left transition-all hover:border-brand-400 hover:bg-brand-50/40"
          >
            <span className="rounded-lg bg-brand-50 p-2 text-brand-600">
              <Icon name="bolt" className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-ink-900">
                {m.nome}
              </span>
              <span className="block text-[13px] text-ink-500">
                {m.descricao}
              </span>
            </span>
            <Icon name="chevronRight" className="size-4 text-ink-300" />
          </button>
        ))}
        <button
          onClick={() => criar(novaRegua)}
          className="flex w-full items-center gap-3 rounded-xl border border-dashed border-ink-300 p-4 text-left transition-all hover:border-brand-400 hover:bg-brand-50/40"
        >
          <span className="rounded-lg bg-ink-100 p-2 text-ink-500">
            <Icon name="plus" className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-ink-900">
              Começar do zero
            </span>
            <span className="block text-[13px] text-ink-500">
              Você monta cada etapa na mão.
            </span>
          </span>
        </button>
      </div>
    </Modal>
  );
}

/* -------------------------------------------------- Modal: nova cobrança */

function ModalNovaCobranca({
  aberto,
  aoFechar,
}: {
  aberto: boolean;
  aoFechar: () => void;
}) {
  const app = useApp();
  const [nome, setNome] = useState("");
  const [tel, setTel] = useState("");
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [vencimento, setVencimento] = useState("");
  const [reguaId, setReguaId] = useState<string>(app.reguas[0]?.id ?? "");
  const [erro, setErro] = useState("");

  function salvar() {
    if (!nome.trim() || !valor || !vencimento) {
      setErro("Preencha nome, valor e vencimento.");
      return;
    }
    app.criarCobranca({
      clienteNome: nome.trim(),
      clienteTelefone: tel.replace(/\D/g, "") || "5511900000000",
      descricao: descricao.trim() || "Cobrança avulsa",
      valor: Number(valor.replace(",", ".")),
      vencimento: new Date(`${vencimento}T12:00:00`).toISOString(),
      status: "pendente",
      reguaId: reguaId || null,
      tentativas: 0,
      ultimoEnvio: null,
      pagoEm: null,
      tags: [],
    });
    app.notificar("Cobrança criada. A régua assume daqui.");
    setNome("");
    setTel("");
    setDescricao("");
    setValor("");
    setVencimento("");
    setErro("");
    aoFechar();
  }

  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      titulo="Nova cobrança"
      subtitulo="A partir daqui a régua escolhida cuida de tudo."
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao onClick={salvar} icone="check">
            Criar cobrança
          </Botao>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo label="Cliente" obrigatorio>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Marina Alves"
            />
          </Campo>
          <Campo label="WhatsApp">
            <Input
              value={tel}
              onChange={(e) => setTel(e.target.value)}
              placeholder="(11) 99123-4501"
            />
          </Campo>
        </div>
        <Campo label="Descrição">
          <Input
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Sessão de limpeza de pele"
          />
        </Campo>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo label="Valor (R$)" obrigatorio>
            <Input
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              placeholder="280,00"
              inputMode="decimal"
            />
          </Campo>
          <Campo label="Vencimento" obrigatorio>
            <Input
              type="date"
              value={vencimento}
              onChange={(e) => setVencimento(e.target.value)}
            />
          </Campo>
        </div>
        <Campo
          label="Régua de cobrança"
          dica="A IA seguirá essa sequência automaticamente."
          erro={erro || undefined}
        >
          <Select value={reguaId} onChange={(e) => setReguaId(e.target.value)}>
            <option value="">Sem automação (só registrar)</option>
            {app.reguas.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nome} {r.ativa ? "" : "(pausada)"}
              </option>
            ))}
          </Select>
        </Campo>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------- Modal: detalhe/ações */

function ModalDetalhe({
  cobranca,
  aoFechar,
}: {
  cobranca: Cobranca | null;
  aoFechar: () => void;
}) {
  const app = useApp();
  const [obs, setObs] = useState("");
  if (!cobranca) return null;
  const regua = app.reguas.find((r) => r.id === cobranca.reguaId);

  return (
    <Modal
      aberto={!!cobranca}
      aoFechar={aoFechar}
      titulo={cobranca.clienteNome}
      subtitulo={telefone(cobranca.clienteTelefone)}
      rodape={
        <>
          {cobranca.status !== "cancelado" && cobranca.status !== "pago" && (
            <Botao
              variante="fantasma"
              onClick={() => {
                app.cancelarCobranca(cobranca.id);
                app.notificar("Cobrança cancelada.", "info");
                aoFechar();
              }}
            >
              Cancelar cobrança
            </Botao>
          )}
          {cobranca.status !== "pago" && (
            <Botao
              icone="check"
              onClick={() => {
                app.marcarPago(cobranca.id);
                app.notificar(
                  `${brl(cobranca.valor)} recebido de ${cobranca.clienteNome.split(" ")[0]}!`,
                );
                aoFechar();
              }}
            >
              Marcar como pago
            </Botao>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-xl bg-ink-50 p-4">
          <div>
            <p className="text-[13px] text-ink-500">{cobranca.descricao}</p>
            <p className="text-2xl font-semibold text-ink-900">
              {brl(cobranca.valor, true)}
            </p>
          </div>
          <div className="text-right">
            <Badge tom={TOM_STATUS[cobranca.status]}>
              {NOME_STATUS[cobranca.status]}
            </Badge>
            <p className="mt-1.5 text-[13px] text-ink-500">
              Vence {dataCurta(cobranca.vencimento)}
            </p>
            <p className="text-xs text-ink-400">
              {prazoRelativo(cobranca.vencimento)}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-[13px]">
          <div className="rounded-xl border border-ink-200 p-3">
            <p className="text-ink-500">Régua aplicada</p>
            <p className="mt-0.5 font-medium text-ink-900">
              {regua ? regua.nome : "Nenhuma"}
            </p>
          </div>
          <div className="rounded-xl border border-ink-200 p-3">
            <p className="text-ink-500">Mensagens enviadas</p>
            <p className="mt-0.5 font-medium text-ink-900">
              {cobranca.tentativas}
              {cobranca.ultimoEnvio && (
                <span className="ml-1 font-normal text-ink-400">
                  · última {dataCurta(cobranca.ultimoEnvio)}
                </span>
              )}
            </p>
          </div>
        </div>

        {cobranca.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {cobranca.tags.map((t) => (
              <Badge key={t} tom="neutro">
                {t}
              </Badge>
            ))}
          </div>
        )}

        <Campo label="Anotação interna" dica="Só você enxerga.">
          <Textarea
            rows={2}
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            placeholder="Ex.: cliente pediu pra cobrar depois do dia 10."
          />
        </Campo>
      </div>
    </Modal>
  );
}
