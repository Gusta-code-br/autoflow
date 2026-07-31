"use client";

import { useMemo, useState } from "react";
import { Bloqueado, Pagina } from "@/components/shell";
import {
  Badge,
  Botao,
  Campo,
  Estatistica,
  Input,
  Modal,
  Select,
  Switch,
  Vazio,
  cx,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import { useApp } from "@/lib/store";
import { dataCurta, diaSemana, hora, telefone } from "@/lib/format";
import type { Agendamento, StatusAgendamento } from "@/lib/types";

const NOME_STATUS: Record<StatusAgendamento, string> = {
  confirmado: "Confirmado",
  pendente: "Pendente",
  cancelado: "Cancelado",
  concluido: "Concluído",
};

const TOM_STATUS: Record<
  StatusAgendamento,
  "sucesso" | "aviso" | "perigo" | "neutro"
> = {
  confirmado: "sucesso",
  pendente: "aviso",
  cancelado: "perigo",
  concluido: "neutro",
};

const CARTAO_STATUS: Record<StatusAgendamento, string> = {
  confirmado: "border-emerald-200 bg-emerald-50 text-emerald-800",
  pendente: "border-amber-200 bg-amber-50 text-amber-800",
  cancelado: "border-rose-200 bg-rose-50 text-rose-700 line-through",
  concluido: "border-ink-200 bg-ink-100 text-ink-600",
};

function inicioDaSemana(base: Date): Date {
  const d = new Date(base);
  const diaSemanaNum = d.getDay(); // 0 = domingo
  const offset = diaSemanaNum === 0 ? -6 : 1 - diaSemanaNum;
  d.setDate(d.getDate() + offset);
  d.setHours(0, 0, 0, 0);
  return d;
}

function mesmoDia(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const DIAS_LABEL = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

function AgendaConteudo() {
  const app = useApp();
  const [modalNovo, setModalNovo] = useState(false);
  const [detalhe, setDetalhe] = useState<Agendamento | null>(null);

  const [cliente, setCliente] = useState("");
  const [telefoneForm, setTelefoneForm] = useState("");
  const [servico, setServico] = useState("");
  const [data, setData] = useState("");
  const [horaForm, setHoraForm] = useState("");
  const [duracao, setDuracao] = useState("30");

  const hoje = useMemo(() => new Date(), []);
  const inicioSemana = useMemo(() => inicioDaSemana(hoje), [hoje]);
  const diasSemana = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date(inicioSemana);
        d.setDate(d.getDate() + i);
        return d;
      }),
    [inicioSemana],
  );

  const agendamentosOrdenados = useMemo(
    () =>
      [...app.agendamentos].sort(
        (a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime(),
      ),
    [app.agendamentos],
  );

  const hojeCount = agendamentosOrdenados.filter((a) =>
    mesmoDia(new Date(a.inicio), hoje),
  ).length;

  const semanaCount = agendamentosOrdenados.filter((a) => {
    const dt = new Date(a.inicio);
    return diasSemana.some((d) => mesmoDia(d, dt));
  }).length;

  const aguardando = agendamentosOrdenados.filter(
    (a) => a.status === "pendente",
  ).length;

  const concluidos = agendamentosOrdenados.filter(
    (a) => a.status === "concluido",
  ).length;
  const cancelados = agendamentosOrdenados.filter(
    (a) => a.status === "cancelado",
  ).length;
  const taxaComparecimento =
    concluidos + cancelados > 0
      ? Math.round((concluidos / (concluidos + cancelados)) * 100)
      : 100;

  const inicioHoje = useMemo(() => {
    const d = new Date(hoje);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, [hoje]);

  const proximos = useMemo(
    () =>
      agendamentosOrdenados.filter(
        (a) => new Date(a.inicio).getTime() >= inicioHoje,
      ),
    [agendamentosOrdenados, inicioHoje],
  );

  function agendamentosDoDia(d: Date) {
    return agendamentosOrdenados.filter((a) =>
      mesmoDia(new Date(a.inicio), d),
    );
  }

  function abrirNovo() {
    setCliente("");
    setTelefoneForm("");
    setServico("");
    setData("");
    setHoraForm("");
    setDuracao("30");
    setModalNovo(true);
  }

  function salvarNovo() {
    if (!cliente.trim() || !data || !horaForm || !servico.trim()) return;
    const inicio = new Date(`${data}T${horaForm}:00`).toISOString();
    app.criarAgendamento({
      clienteNome: cliente.trim(),
      clienteTelefone: telefoneForm.replace(/\D/g, ""),
      servico: servico.trim(),
      inicio,
      duracaoMin: Number(duracao) || 30,
      status: "confirmado",
      origem: "manual",
      observacao: "",
    });
    app.notificar("Agendamento criado.");
    setModalNovo(false);
  }

  return (
    <Pagina
      titulo="Agenda"
      descricao="Tudo que a IA marcou pra você, em um lugar só."
      acao={
        <Botao icone="plus" onClick={abrirNovo}>
          Novo agendamento
        </Botao>
      }
    >
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Estatistica
          rotulo="Hoje"
          valor={String(hojeCount)}
          icone="calendar"
          tom="marca"
        />
        <Estatistica
          rotulo="Esta semana"
          valor={String(semanaCount)}
          icone="chart"
          tom="info"
        />
        <Estatistica
          rotulo="Aguardando confirmação"
          valor={String(aguardando)}
          icone="clock"
          tom="aviso"
        />
        <Estatistica
          rotulo="Taxa de comparecimento"
          valor={`${taxaComparecimento}%`}
          icone="check"
          tom="sucesso"
        />
      </div>

      {/* Visão semanal */}
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7">
        {diasSemana.map((d, i) => {
          const eHoje = mesmoDia(d, hoje);
          const itens = agendamentosDoDia(d);
          return (
            <div
              key={d.toISOString()}
              className={cx(
                "flex min-h-[140px] flex-col rounded-2xl border bg-white p-3",
                eHoje ? "border-brand-300 ring-2 ring-brand-100" : "border-ink-200",
              )}
            >
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                  {DIAS_LABEL[i]}
                </p>
                <p
                  className={cx(
                    "flex size-6 items-center justify-center rounded-full text-[12px] font-semibold",
                    eHoje ? "bg-brand-600 text-white" : "text-ink-700",
                  )}
                >
                  {d.getDate()}
                </p>
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                {itens.length === 0 ? (
                  <p className="mt-2 text-center text-[11px] text-ink-300">—</p>
                ) : (
                  itens.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => setDetalhe(a)}
                      className={cx(
                        "rounded-lg border px-2 py-1.5 text-left text-[11.5px] leading-tight transition-transform hover:scale-[1.02]",
                        CARTAO_STATUS[a.status],
                      )}
                    >
                      <p className="font-semibold">{hora(a.inicio)}</p>
                      <p className="truncate">{a.clienteNome}</p>
                    </button>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Próximos */}
        <div className="lg:col-span-2">
          <h2 className="mb-3 text-[15px] font-semibold text-ink-900">
            Próximos agendamentos
          </h2>
          {proximos.length === 0 ? (
            <div className="rounded-2xl border border-ink-200 bg-white">
              <Vazio
                icone="calendar"
                titulo="Nada agendado ainda"
                descricao="Assim que a IA marcar um horário, ele aparece aqui."
              />
            </div>
          ) : (
            <ul className="space-y-2.5">
              {proximos.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-col gap-3 rounded-2xl border border-ink-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-[14px] font-semibold text-ink-900">
                        {a.clienteNome}
                      </p>
                      <Badge tom={TOM_STATUS[a.status]}>
                        {NOME_STATUS[a.status]}
                      </Badge>
                      {a.origem === "ia" && (
                        <Badge tom="marca" icone="spark">
                          Agendado pela IA
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-[13px] text-ink-500">
                      {a.servico} · {diaSemana(a.inicio)}, {dataCurta(a.inicio)}{" "}
                      às {hora(a.inicio)} · {a.duracaoMin} min
                    </p>
                  </div>
                  {(a.status === "pendente" || a.status === "confirmado") && (
                    <div className="flex shrink-0 gap-2">
                      {a.status === "pendente" && (
                        <Botao
                          tamanho="sm"
                          variante="secundario"
                          icone="check"
                          onClick={() =>
                            app.mudarStatusAgendamento(a.id, "confirmado")
                          }
                        >
                          Confirmar
                        </Botao>
                      )}
                      <Botao
                        tamanho="sm"
                        variante="fantasma"
                        icone="x"
                        onClick={() =>
                          app.mudarStatusAgendamento(a.id, "cancelado")
                        }
                      >
                        Cancelar
                      </Botao>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Aviso no WhatsApp pessoal */}
        <AvisoWhatsappPessoal />
      </div>

      {/* Modal detalhe */}
      <Modal
        aberto={!!detalhe}
        aoFechar={() => setDetalhe(null)}
        titulo={detalhe?.clienteNome ?? ""}
        subtitulo={detalhe ? telefone(detalhe.clienteTelefone) : undefined}
        rodape={
          detalhe && (
            <>
              {detalhe.status !== "cancelado" && (
                <Botao
                  variante="perigo"
                  tamanho="sm"
                  onClick={() => {
                    app.mudarStatusAgendamento(detalhe.id, "cancelado");
                    setDetalhe(null);
                  }}
                >
                  Cancelar agendamento
                </Botao>
              )}
              {detalhe.status === "pendente" && (
                <Botao
                  tamanho="sm"
                  onClick={() => {
                    app.mudarStatusAgendamento(detalhe.id, "confirmado");
                    setDetalhe(null);
                  }}
                >
                  Confirmar
                </Botao>
              )}
            </>
          )
        }
      >
        {detalhe && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <Badge tom={TOM_STATUS[detalhe.status]}>
                {NOME_STATUS[detalhe.status]}
              </Badge>
              {detalhe.origem === "ia" && (
                <Badge tom="marca" icone="spark">
                  Agendado pela IA
                </Badge>
              )}
            </div>
            <p>
              <span className="font-medium text-ink-700">Serviço:</span>{" "}
              {detalhe.servico}
            </p>
            <p>
              <span className="font-medium text-ink-700">Quando:</span>{" "}
              {diaSemana(detalhe.inicio)}, {dataCurta(detalhe.inicio)} às{" "}
              {hora(detalhe.inicio)} ({detalhe.duracaoMin} min)
            </p>
            {detalhe.observacao && (
              <p>
                <span className="font-medium text-ink-700">Observação:</span>{" "}
                {detalhe.observacao}
              </p>
            )}
          </div>
        )}
      </Modal>

      {/* Modal novo agendamento */}
      <Modal
        aberto={modalNovo}
        aoFechar={() => setModalNovo(false)}
        titulo="Novo agendamento"
        subtitulo="Cria um horário manualmente na sua agenda."
        rodape={
          <>
            <Botao variante="secundario" onClick={() => setModalNovo(false)}>
              Cancelar
            </Botao>
            <Botao onClick={salvarNovo}>Salvar agendamento</Botao>
          </>
        }
      >
        <div className="space-y-4">
          <Campo label="Cliente" obrigatorio>
            <Input
              value={cliente}
              onChange={(e) => setCliente(e.target.value)}
              placeholder="Nome do cliente"
            />
          </Campo>
          <Campo label="Telefone">
            <Input
              value={telefoneForm}
              onChange={(e) => setTelefoneForm(e.target.value)}
              placeholder="(11) 99999-0000"
            />
          </Campo>
          <Campo label="Serviço" obrigatorio>
            <Input
              value={servico}
              onChange={(e) => setServico(e.target.value)}
              placeholder="Ex.: Avaliação facial"
            />
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Data" obrigatorio>
              <Input
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
              />
            </Campo>
            <Campo label="Hora" obrigatorio>
              <Input
                type="time"
                value={horaForm}
                onChange={(e) => setHoraForm(e.target.value)}
              />
            </Campo>
          </div>
          <Campo label="Duração">
            <Select value={duracao} onChange={(e) => setDuracao(e.target.value)}>
              <option value="15">15 min</option>
              <option value="30">30 min</option>
              <option value="45">45 min</option>
              <option value="60">1 hora</option>
              <option value="90">1h30</option>
              <option value="120">2 horas</option>
            </Select>
          </Campo>
        </div>
      </Modal>
    </Pagina>
  );
}

function AvisoWhatsappPessoal() {
  const app = useApp();
  return (
    <div>
      <h2 className="mb-3 text-[15px] font-semibold text-ink-900">
        Aviso no seu WhatsApp pessoal
      </h2>
      <div className="rounded-2xl border border-ink-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[13px] font-medium text-ink-700">
              Número cadastrado
            </p>
            <p className="text-sm text-ink-900">
              {app.conta.whatsappPessoal
                ? telefone(app.conta.whatsappPessoal)
                : "Nenhum número cadastrado"}
            </p>
          </div>
          <span className="rounded-lg bg-zap/10 p-2 text-zap-dark">
            <Icon name="whatsapp" className="size-4" />
          </span>
        </div>

        <div className="mt-4 border-t border-ink-100 pt-4">
          <Switch
            ativo={app.conta.notificarNovoAgendamento}
            onChange={(v) =>
              app.atualizarConta({ notificarNovoAgendamento: v })
            }
            label="Avisar a cada novo agendamento"
            descricao="Você recebe uma mensagem no seu WhatsApp pessoal assim que a IA fecha um horário."
          />
        </div>

        <div className="mt-4 rounded-xl bg-[#e5ddd3] p-3">
          <p className="mb-2 text-[11px] font-medium text-ink-500">Prévia</p>
          <div className="max-w-[240px] rounded-2xl rounded-tl-sm bg-white px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-900 shadow-sm">
            🗓️ Novo agendamento! Helena Prado — Avaliação facial, quinta 14h.
            Marcado pela {app.conta.nomeAtendente || "IA"} às 15:32.
          </div>
        </div>

        <Botao
          variante="secundario"
          tamanho="sm"
          className="mt-4 w-full"
          icone="send"
          disabled={!app.conta.whatsappPessoal}
          onClick={() =>
            app.notificar("Mensagem de teste enviada para o seu WhatsApp")
          }
        >
          Enviar teste
        </Botao>
      </div>
    </div>
  );
}

export default function AgendaPage() {
  const app = useApp();
  if (!app.tem("agendamento")) return <Bloqueado feature="agendamento" />;
  return <AgendaConteudo />;
}
