import Link from "next/link";

import { Bloqueado, Pagina } from "@/components/shell";
import { Badge, Card, CardTitulo, Estatistica, Vazio } from "@/components/ui";
import { cx } from "@/lib/cx";
import { brl, telefone } from "@/lib/format";
import { centavosParaReais } from "@/server/dominio/dinheiro";
import { painelAgenda, type AgendamentoDTO } from "@/server/dal/agenda";
import { carregarSessaoPainel } from "@/server/dal/painel";
import {
  dataLocalDe,
  horaLocalDe,
  somarDias,
  type DataLocal,
} from "@/server/dominio/tempo";
import {
  AcoesAgendamento,
  BotaoBloquear,
  BotaoNovo,
  BotaoRemoverBloqueio,
  BotaoServico,
} from "./interacoes";

/**
 * Agenda da semana, servida pelo servidor.
 *
 * O dia escolhido mora na URL (`?dia=YYYY-MM-DD`) e não em `useState`: assim o
 * link de um dia cheio pode ser mandado para o time, o botão voltar funciona e
 * a lista chega pronta. Todas as contas de calendário rodam no fuso da
 * organização — o container roda em UTC, e uma barbearia em Rio Branco não pode
 * ver o expediente deslocado em 5 horas.
 */

const NOME_STATUS: Record<AgendamentoDTO["status"], string> = {
  pendente: "A confirmar",
  confirmado: "Confirmado",
  concluido: "Atendido",
  cancelado: "Cancelado",
  faltou: "Faltou",
};

const TOM_STATUS: Record<
  AgendamentoDTO["status"],
  "aviso" | "sucesso" | "neutro" | "perigo" | "info"
> = {
  pendente: "aviso",
  confirmado: "info",
  concluido: "sucesso",
  cancelado: "neutro",
  faltou: "perigo",
};

const DIAS_LABEL = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** Dia da semana (0=domingo) de uma data local, sem passar pelo fuso do runtime. */
function diaDaSemana(dia: DataLocal): number {
  return new Date(`${dia}T12:00:00Z`).getUTCDay();
}

/** Rótulo curto "09/set" a partir de `YYYY-MM-DD`, sem `new Date` local. */
function diaDoMes(dia: DataLocal): number {
  return Number(dia.slice(8, 10));
}

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ dia?: string }>;
}) {
  const sessao = await carregarSessaoPainel();
  if (!sessao.plano.features.includes("agendamento")) {
    return <Bloqueado feature="agendamento" />;
  }

  const params = await searchParams;
  const pedido = /^\d{4}-\d{2}-\d{2}$/.test(params.dia ?? "")
    ? (params.dia as DataLocal)
    : undefined;

  const painel = await painelAgenda(pedido);
  const { fuso, expediente, resumo } = painel;

  const hoje = dataLocalDe(new Date(), fuso);
  const dia = painel.dia;

  // Semana de segunda a domingo, como o brasileiro lê calendário.
  const dow = diaDaSemana(dia);
  const segunda = somarDias(dia, -((dow + 6) % 7));
  const semana = Array.from({ length: 7 }, (_, i) => somarDias(segunda, i));

  const doDia = painel.agendamentos.filter(
    (a) => dataLocalDe(a.inicio, fuso) === dia,
  );
  const bloqueiosDoDia = painel.bloqueios.filter(
    (b) => dataLocalDe(b.inicio, fuso) === dia,
  );

  const porDia = new Map<string, number>();
  for (const a of painel.agendamentos) {
    if (a.status === "cancelado") continue;
    const d = dataLocalDe(a.inicio, fuso);
    porDia.set(d, (porDia.get(d) ?? 0) + 1);
  }

  const servicosAtivos = painel.servicos.filter((s) => s.ativo);

  return (
    <Pagina
      titulo="Agenda"
      descricao="Tudo que a IA marcou no seu nome, mais o que você marcar aqui."
      acao={
        <div className="flex gap-2">
          <BotaoBloquear dia={dia} />
          <BotaoNovo dia={dia} servicos={servicosAtivos} />
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Estatistica rotulo="Hoje" valor={String(resumo.hoje)} icone="calendar" />
        <Estatistica
          rotulo="Próximos 7 dias"
          valor={String(resumo.semana)}
          icone="clock"
          tom="info"
        />
        <Estatistica
          rotulo="Aguardando confirmação"
          valor={String(resumo.pendentesConfirmacao)}
          icone="alert"
          tom="aviso"
        />
        <Estatistica
          rotulo="Taxa de comparecimento"
          valor={
            resumo.taxaComparecimento === null
              ? "—"
              : `${resumo.taxaComparecimento}%`
          }
          detalhe={
            resumo.taxaComparecimento === null
              ? "Poucos atendimentos fechados para calcular"
              : "Últimos 90 dias"
          }
          icone="check"
          tom="sucesso"
        />
      </div>

      {/* Semana */}
      <div className="mt-6 grid grid-cols-7 gap-2">
        {semana.map((d) => {
          const ativo = d === dia;
          const eHoje = d === hoje;
          const trabalha = expediente.diasSemana.includes(diaDaSemana(d));
          const total = porDia.get(d) ?? 0;
          return (
            <Link
              key={d}
              href={`/painel/agenda?dia=${d}`}
              className={cx(
                "rounded-xl border p-2 text-center transition-colors",
                ativo
                  ? "border-brand-600 bg-brand-600 text-white"
                  : trabalha
                    ? "border-ink-200 bg-white hover:border-ink-300"
                    : "border-ink-100 bg-ink-50 text-ink-400",
              )}
            >
              <p
                className={cx(
                  "text-[11px] uppercase",
                  ativo ? "text-white/70" : "text-ink-500",
                )}
              >
                {DIAS_LABEL[diaDaSemana(d)]}
              </p>
              <p
                className={cx(
                  "mt-0.5 text-[15px] font-semibold",
                  eHoje && !ativo && "text-brand-700",
                )}
              >
                {diaDoMes(d)}
              </p>
              <p
                className={cx(
                  "mt-1 text-[11px]",
                  ativo ? "text-white/80" : "text-ink-500",
                )}
              >
                {total > 0 ? total : "—"}
              </p>
            </Link>
          );
        })}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* Dia */}
        <Card>
          <CardTitulo
            titulo={dia === hoje ? "Hoje" : `Dia ${diaDoMes(dia)}`}
            subtitulo={`Expediente ${expediente.inicio} às ${expediente.fim}`}
          />
          {doDia.length === 0 && bloqueiosDoDia.length === 0 ? (
            <Vazio
              icone="calendar"
              titulo="Nada marcado neste dia"
              descricao="Quando a IA marcar por WhatsApp, aparece aqui na hora."
            />
          ) : (
            <ul className="divide-y divide-ink-100">
              {bloqueiosDoDia.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center gap-3 py-3 text-ink-500"
                >
                  <span className="w-[92px] shrink-0 text-[13px] tabular-nums">
                    {horaLocalDe(b.inicio, fuso)}–{horaLocalDe(b.fim, fuso)}
                  </span>
                  <span className="flex-1 text-[13.5px]">
                    Bloqueado{b.motivo ? ` · ${b.motivo}` : ""}
                  </span>
                  <BotaoRemoverBloqueio id={b.id} />
                </li>
              ))}
              {doDia.map((a) => (
                <li key={a.id} className="flex items-start gap-3 py-3">
                  <div className="w-[92px] shrink-0">
                    <p className="text-[13px] font-semibold tabular-nums text-ink-900">
                      {horaLocalDe(a.inicio, fuso)}
                    </p>
                    <p className="text-[11.5px] text-ink-400 tabular-nums">
                      até {horaLocalDe(a.fim, fuso)}
                    </p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[14px] font-medium text-ink-900">
                        {a.contatoNome}
                      </p>
                      <Badge tom={TOM_STATUS[a.status]}>
                        {NOME_STATUS[a.status]}
                      </Badge>
                      {a.origem === "ia" && <Badge tom="marca">IA</Badge>}
                    </div>
                    <p className="mt-0.5 text-[13px] text-ink-500">
                      {a.servicoNome ?? "Sem serviço"} ·{" "}
                      {telefone(a.contatoTelefone)}
                    </p>
                    {a.observacao && (
                      <p className="mt-1 text-[12.5px] text-ink-500">
                        {a.observacao}
                      </p>
                    )}
                    {a.conversaId && (
                      <Link
                        href={`/painel/atendimento?c=${a.conversaId}`}
                        className="mt-1 inline-flex items-center gap-1 text-[12.5px] font-medium text-brand-700 hover:underline"
                      >
                        Ver conversa
                      </Link>
                    )}
                  </div>
                  <AcoesAgendamento id={a.id} status={a.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Serviços */}
        <Card>
          <CardTitulo
            titulo="Serviços"
            subtitulo="O que a IA pode oferecer e quanto tempo reservar"
            acao={<BotaoServico />}
          />
          {painel.servicos.length === 0 ? (
            <Vazio
              icone="gear"
              titulo="Nenhum serviço cadastrado"
              descricao="Sem serviço a IA não sabe quanto tempo reservar nem quanto cobrar."
            />
          ) : (
            <ul className="divide-y divide-ink-100">
              {painel.servicos.map((s) => (
                <li key={s.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p
                      className={cx(
                        "truncate text-[13.5px] font-medium",
                        s.ativo ? "text-ink-900" : "text-ink-400 line-through",
                      )}
                    >
                      {s.nome}
                    </p>
                    <p className="text-[12px] text-ink-500">
                      {s.duracaoMin} min
                      {s.intervaloMin > 0 && ` + ${s.intervaloMin} de intervalo`}
                      {s.preco !== null &&
                        ` · ${brl(centavosParaReais(s.preco), true)}`}
                    </p>
                  </div>
                  <BotaoServico servico={s} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </Pagina>
  );
}
