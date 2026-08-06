import Link from "next/link";

import { Pagina } from "@/components/shell";
import { Barra, Botao, Card, CardTitulo, Vazio } from "@/components/ui";
import { cx } from "@/lib/cx";
import { FlashToast } from "@/components/toast";
import { Icon, type IconName } from "@/components/icons";
import { brl, dataLonga, numero, tempoRelativo } from "@/lib/format";
import {
  carregarSessaoPainel,
  resumoPainel,
  usoDiario,
  type Atividade,
  type Pendencia,
} from "@/server/dal/painel";
import { centavosParaReais } from "@/server/dominio/dinheiro";
import { GraficoUso } from "./grafico-uso";

/**
 * Visão geral.
 *
 * Server Component: os três `await` são o painel inteiro. Antes esta tela lia
 * o store de demonstração no browser, e por isso mostrava a mesma padaria
 * fictícia para todo mundo depois do login.
 */
export default async function PainelPage({
  searchParams,
}: {
  searchParams: Promise<{ bemvindo?: string }>;
}) {
  const [sessao, resumo, uso, params] = await Promise.all([
    carregarSessaoPainel(),
    resumoPainel(),
    usoDiario(),
    searchParams,
  ]);

  const temCobranca = sessao.plano.features.includes("cobranca");
  const temAgendamento = sessao.plano.features.includes("agendamento");

  /*
   * Saudação no fuso da empresa, não no do servidor: um cliente em Rio Branco
   * às 19h não pode ler "Bom dia" só porque o container roda em UTC. Como sai
   * pronta do servidor, também não há mismatch de hidratação.
   */
  const agora = new Date();
  const horaLocal = Number(
    new Intl.DateTimeFormat("pt-BR", {
      hour: "numeric",
      hour12: false,
      timeZone: sessao.org.fuso,
    }).format(agora),
  );
  const saudacao =
    horaLocal < 12 ? "Bom dia" : horaLocal < 18 ? "Boa tarde" : "Boa noite";

  /*
   * Projeção de duração dos créditos pela média dos 14 dias — a mesma janela do
   * gráfico logo acima, para o texto não contradizer o desenho.
   */
  const mediaDiaria = uso.length
    ? uso.reduce(
        (s, u) => s + u.atendimento + u.cobranca + u.agendamento,
        0,
      ) / uso.length
    : 0;
  const diasRestantes =
    mediaDiaria > 0 ? Math.floor(sessao.creditos.restantes / mediaDiaria) : null;
  const dataProjetada =
    diasRestantes !== null
      ? new Date(agora.getTime() + diasRestantes * 86400000).toISOString()
      : null;

  return (
    <Pagina
      titulo="Visão geral"
      descricao={`${saudacao}, ${sessao.org.nome}! Aqui está um resumo do que está acontecendo hoje.`}
    >
      {params.bemvindo && (
        <FlashToast
          param="bemvindo"
          mensagem={`Tudo pronto, ${sessao.org.nome}! Sua conta está configurada — agora é só conectar o WhatsApp.`}
        />
      )}
      {sessao.conexoes.totais === 0 && (
        <Card className="mb-6 flex flex-col items-start gap-3 border-brand-200 bg-brand-50/60 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-brand-100 p-2.5 text-brand-700">
              <Icon name="plug" className="size-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-ink-900">
                Conecte seu WhatsApp para começar
              </p>
              <p className="text-[13px] text-ink-600">
                Sem um número conectado, a IA ainda não consegue atender, cobrar
                ou agendar por você.
              </p>
            </div>
          </div>
          <Link href="/painel/conexoes">
            <Botao iconeDireita="arrowRight">Conectar WhatsApp</Botao>
          </Link>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          rotulo="Conversas ativas hoje"
          valor={numero(resumo.atendimento.conversasAtivas)}
          icone="chat"
          tom="marca"
        />
        <StatCard
          rotulo="Mensagens não lidas"
          valor={numero(resumo.atendimento.naoLidas)}
          icone="bell"
          tom={resumo.atendimento.naoLidas > 0 ? "aviso" : "marca"}
        />
        {temCobranca && sessao.verFinanceiro && (
          <StatCard
            rotulo="Valor em aberto"
            valor={brl(centavosParaReais(resumo.cobranca.emAberto))}
            icone="cash"
            tom="perigo"
          />
        )}
        {temAgendamento && (
          <StatCard
            rotulo="Agendamentos da semana"
            valor={numero(resumo.agenda.semana)}
            icone="calendar"
            tom="info"
          />
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardTitulo
              titulo="Uso de IA nos últimos 14 dias"
              subtitulo="Mensagens consumidas por módulo, por dia"
            />
            <div className="p-5">
              <GraficoUso dias={uso} />
            </div>
          </Card>

          <Card>
            <CardTitulo
              titulo="Últimas atividades"
              subtitulo="Tudo que aconteceu por aqui"
            />
            <div className="p-5">
              {resumo.atividades.length === 0 ? (
                <Vazio
                  icone="clock"
                  titulo="Nenhuma atividade ainda"
                  descricao="Assim que sua IA começar a atender, cobrar ou agendar, tudo vai aparecer aqui."
                />
              ) : (
                <ul className="space-y-4">
                  {resumo.atividades.map((a) => (
                    <li key={a.id} className="flex items-start gap-3">
                      <span
                        className={cx(
                          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
                          TOM_ATIVIDADE[a.tipo],
                        )}
                      >
                        <Icon name={ICONE[a.tipo]} className="size-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] leading-relaxed text-ink-700">
                          {a.texto}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-ink-400">
                        {tempoRelativo(a.quando.toISOString())}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardTitulo titulo="Créditos de IA" subtitulo="Sua cota deste mês" />
            <div className="p-5">
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium text-ink-800">
                  {numero(sessao.creditos.restantes)} restantes
                </span>
                <span className="text-ink-500">
                  de {numero(sessao.creditos.totais)}
                </span>
              </div>
              <Barra
                valor={sessao.creditos.percentual}
                tom={
                  sessao.creditos.percentual > 90
                    ? "perigo"
                    : sessao.creditos.percentual > 70
                      ? "aviso"
                      : "marca"
                }
                className="mt-2.5"
              />
              <p className="mt-3 text-[13px] leading-relaxed text-ink-500">
                {sessao.creditos.restantes === 0
                  ? "Seus créditos acabaram. Recarregue para a IA continuar respondendo."
                  : dataProjetada
                    ? `No ritmo atual, seus créditos duram até ${dataLonga(dataProjetada)}.`
                    : "Ainda não há uso suficiente para projetar a duração dos créditos."}
              </p>
              {sessao.verFinanceiro && (
                <Link href="/painel/creditos" className="mt-4 block">
                  <Botao
                    variante="secundario"
                    className="w-full"
                    iconeDireita="arrowRight"
                  >
                    Ver plano e créditos
                  </Botao>
                </Link>
              )}
            </div>
          </Card>

          <Card>
            <CardTitulo
              titulo="Precisa de você"
              subtitulo="Pendências que merecem atenção"
            />
            <div className="p-2">
              {resumo.pendencias.length === 0 ? (
                <Vazio
                  icone="check"
                  titulo="Tudo em dia!"
                  descricao="Nenhuma pendência agora."
                />
              ) : (
                <ul>
                  {resumo.pendencias.map((p) => (
                    <li key={p.id}>
                      <Link
                        href={p.href}
                        className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-ink-50"
                      >
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600">
                          <Icon name={ICONE[p.tipo]} className="size-3.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-ink-800">
                            {p.texto}
                          </p>
                          <p className="text-xs text-ink-500">{p.detalhe}</p>
                        </div>
                        <Icon
                          name="chevronRight"
                          className="size-4 shrink-0 text-ink-300"
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>
      </div>
    </Pagina>
  );
}

const ICONE: Record<Pendencia["tipo"], IconName> = {
  conversa: "chat",
  cobranca: "cash",
  agendamento: "calendar",
  conexao: "plug",
};

const TOM_ATIVIDADE: Record<Atividade["tipo"], string> = {
  conversa: "bg-brand-50 text-brand-600",
  cobranca: "bg-emerald-50 text-emerald-600",
  agendamento: "bg-sky-50 text-sky-600",
};

function StatCard({
  rotulo,
  valor,
  icone,
  tom,
}: {
  rotulo: string;
  valor: string;
  icone: IconName;
  tom: "marca" | "sucesso" | "aviso" | "perigo" | "info";
}) {
  const cores: Record<typeof tom, string> = {
    marca: "bg-brand-50 text-brand-700",
    sucesso: "bg-emerald-50 text-emerald-600",
    aviso: "bg-amber-50 text-amber-600",
    perigo: "bg-rose-50 text-rose-600",
    info: "bg-sky-50 text-sky-600",
  };
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-ink-500">{rotulo}</p>
        <span className={cx("rounded-lg p-1.5", cores[tom])}>
          <Icon name={icone} className="size-4" />
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-ink-900">
        {valor}
      </p>
    </Card>
  );
}
