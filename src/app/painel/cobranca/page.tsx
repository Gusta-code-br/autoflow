import Link from "next/link";

import { Icon } from "@/components/icons";
import { Bloqueado, Pagina } from "@/components/shell";
import { Badge, Card, Estatistica, Vazio } from "@/components/ui";
import { cx } from "@/lib/cx";
import { brl, dataCurta, prazoRelativo, telefone, tempoRelativo } from "@/lib/format";
import {
  listarCobrancas,
  resumoCobrancas,
  type CobrancaDTO,
} from "@/server/dal/cobrancas";
import { carregarSessaoPainel } from "@/server/dal/painel";
import { listarReguas, type ReguaResumo } from "@/server/dal/reguas";
import { centavosParaReais } from "@/server/dominio/dinheiro";
import { AcoesCobranca, AcoesRegua, BotaoNovaCobranca } from "./interacoes";

/**
 * Cobrança: a lista do que está na rua e as réguas que correm atrás.
 *
 * Server Component. O filtro e a busca vivem na URL (`?status=&q=`) e o form é
 * `method="get"` — funciona antes do JS carregar, o link é compartilhável com o
 * sócio, e o botão voltar do navegador faz o que promete. O que sobra de
 * browser são os modais, em `interacoes.tsx`.
 *
 * Nada aqui recebe `orgId`: a DAL resolve org e papel pelo cookie, com RLS
 * ligado no banco.
 */

type Aba = "cobrancas" | "reguas";

const FILTROS = [
  { chave: "todas", rotulo: "Todas", status: undefined },
  {
    chave: "aberto",
    rotulo: "Em aberto",
    status: ["pendente", "negociando", "vencido"],
  },
  { chave: "vencido", rotulo: "Vencidas", status: ["vencido"] },
  { chave: "pago", rotulo: "Pagas", status: ["pago"] },
] as const satisfies readonly {
  chave: string;
  rotulo: string;
  status?: readonly CobrancaDTO["status"][];
}[];

const TOM_STATUS = {
  pendente: "aviso",
  pago: "sucesso",
  vencido: "perigo",
  negociando: "info",
  cancelado: "neutro",
} as const;

const NOME_STATUS = {
  pendente: "A vencer",
  pago: "Pago",
  vencido: "Vencido",
  negociando: "Negociando",
  cancelado: "Cancelado",
} as const;

export default async function CobrancaPage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string; filtro?: string; q?: string }>;
}) {
  const sessao = await carregarSessaoPainel();
  if (!sessao.plano.features.includes("cobranca")) {
    return <Bloqueado feature="cobranca" />;
  }

  const params = await searchParams;
  const aba: Aba = params.aba === "reguas" ? "reguas" : "cobrancas";
  const busca = params.q?.trim() ?? "";
  const filtro =
    FILTROS.find((f) => f.chave === params.filtro) ?? FILTROS[0];

  const [resumo, cobrancas, reguas] = await Promise.all([
    resumoCobrancas(),
    listarCobrancas({
      status: filtro.status ? [...filtro.status] : undefined,
      busca,
    }),
    listarReguas(),
  ]);

  const reguasDisponiveis = reguas
    .filter((r) => r.ativa)
    .map((r) => ({ id: r.id, nome: r.nome, padrao: r.padrao }));

  return (
    <Pagina
      titulo="Cobrança"
      descricao="Suas réguas lembram, cobram e insistem no WhatsApp — você só vê o dinheiro cair."
      acao={
        <BotaoNovaCobranca reguas={reguasDisponiveis} />
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Estatistica
          rotulo="Em aberto"
          valor={brl(centavosParaReais(resumo.emAbertoCentavos))}
          detalhe={`${resumo.emAbertoQtd} ${
            resumo.emAbertoQtd === 1 ? "cobrança" : "cobranças"
          }`}
          icone="cash"
        />
        <Estatistica
          rotulo="Vencidas"
          valor={brl(centavosParaReais(resumo.vencidasCentavos))}
          detalhe={`${resumo.vencidasQtd} ${
            resumo.vencidasQtd === 1 ? "cliente atrasado" : "clientes atrasados"
          }`}
          icone="alert"
          tom="perigo"
        />
        <Estatistica
          rotulo="Recebido no mês"
          valor={brl(centavosParaReais(resumo.recebidoMesCentavos))}
          detalhe={
            resumo.recuperadoMesCentavos > 0
              ? `${brl(
                  centavosParaReais(resumo.recuperadoMesCentavos),
                )} depois de uma cobrança da régua`
              : "Ainda sem baixas neste mês"
          }
          icone="check"
          tom="sucesso"
        />
        <Estatistica
          rotulo="Na fila da régua"
          valor={String(resumo.disparosAgendados)}
          detalhe={
            resumo.proximoDisparoEm
              ? `Próxima ${prazoRelativo(resumo.proximoDisparoEm)}`
              : "Nenhuma mensagem agendada"
          }
          icone="clock"
          tom="info"
        />
      </div>

      <div className="mt-6 flex items-center gap-1 border-b border-ink-200">
        <AbaLink aba="cobrancas" atual={aba} q={busca} filtro={params.filtro}>
          Cobranças
          <Contador>{resumo.emAbertoQtd}</Contador>
        </AbaLink>
        <AbaLink aba="reguas" atual={aba} q={busca} filtro={params.filtro}>
          Réguas
          <Contador>{reguas.length}</Contador>
        </AbaLink>
      </div>

      {aba === "cobrancas" ? (
        <ListaCobrancas
          cobrancas={cobrancas}
          filtroAtual={filtro.chave}
          busca={busca}
          temRegua={reguasDisponiveis.length > 0}
          reguas={reguasDisponiveis}
          verFinanceiro={sessao.verFinanceiro}
        />
      ) : (
        <ListaReguas reguas={reguas} />
      )}
    </Pagina>
  );
}

/* ------------------------------------------------------------------- Abas */

function AbaLink({
  aba,
  atual,
  q,
  filtro,
  children,
}: {
  aba: Aba;
  atual: Aba;
  q: string;
  filtro?: string;
  children: React.ReactNode;
}) {
  const busca = new URLSearchParams();
  if (aba !== "cobrancas") busca.set("aba", aba);
  if (q) busca.set("q", q);
  if (filtro) busca.set("filtro", filtro);
  const qs = busca.toString();

  return (
    <Link
      href={`/painel/cobranca${qs ? `?${qs}` : ""}`}
      scroll={false}
      className={cx(
        "-mb-px flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors",
        aba === atual
          ? "border-brand-600 text-brand-700"
          : "border-transparent text-ink-500 hover:text-ink-800",
      )}
    >
      {children}
    </Link>
  );
}

function Contador({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-ink-100 px-1.5 py-0.5 text-[11px] font-semibold text-ink-600">
      {children}
    </span>
  );
}

/* ------------------------------------------------------ Lista de cobranças */

function ListaCobrancas({
  cobrancas,
  filtroAtual,
  busca,
  temRegua,
  reguas,
  verFinanceiro,
}: {
  cobrancas: CobrancaDTO[];
  filtroAtual: string;
  busca: string;
  temRegua: boolean;
  reguas: { id: string; nome: string; padrao: boolean }[];
  verFinanceiro: boolean;
}) {
  return (
    <>
      <form
        method="get"
        className="mt-5 flex flex-wrap items-center justify-between gap-3"
      >
        <div className="flex flex-wrap gap-1.5">
          {FILTROS.map((f) => (
            <button
              key={f.chave}
              name="filtro"
              value={f.chave}
              type="submit"
              className={cx(
                "rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors",
                f.chave === filtroAtual
                  ? "bg-ink-900 text-white"
                  : "bg-ink-100 text-ink-600 hover:bg-ink-200",
              )}
            >
              {f.rotulo}
            </button>
          ))}
        </div>

        <div className="relative min-w-56 flex-1 sm:max-w-72 sm:flex-none">
          <Icon
            name="search"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-400"
          />
          <input
            type="search"
            name="q"
            defaultValue={busca}
            placeholder="Buscar cliente ou descrição"
            aria-label="Buscar cobranças"
            className="h-10 w-full rounded-xl border border-ink-200 bg-white pr-3 pl-9 text-sm text-ink-900 outline-none placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
          {filtroAtual !== "todas" && (
            <input type="hidden" name="filtro" value={filtroAtual} />
          )}
        </div>
      </form>

      <Card className="mt-4 overflow-hidden">
        {cobrancas.length === 0 ? (
          <Vazio
            icone={busca ? "search" : "cash"}
            titulo={
              busca
                ? "Nada encontrado"
                : filtroAtual === "todas"
                  ? "Nenhuma cobrança ainda"
                  : "Nada com esse filtro"
            }
            descricao={
              busca
                ? `Nenhuma cobrança bate com "${busca}".`
                : filtroAtual === "todas"
                  ? temRegua
                    ? "Cadastre a primeira e a régua começa a trabalhar sozinha."
                    : "Monte uma régua na aba ao lado e depois cadastre a primeira cobrança."
                  : "Troque o filtro para ver as outras cobranças."
            }
            acao={
              !busca && filtroAtual === "todas" && temRegua ? (
                <BotaoNovaCobranca reguas={reguas} />
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-ink-100">
            {cobrancas.map((c) => (
              <LinhaCobranca key={c.id} cobranca={c} verFinanceiro={verFinanceiro} />
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function LinhaCobranca({
  cobranca: c,
  verFinanceiro,
}: {
  cobranca: CobrancaDTO;
  verFinanceiro: boolean;
}) {
  const encerrada = c.status === "pago" || c.status === "cancelado";
  const valor = brl(centavosParaReais(c.valorFormatadoCentavos), true);

  return (
    <li className="flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-ink-50/60 sm:px-5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-semibold text-ink-900">
            {c.contato.nome}
          </p>
          <Badge tom={TOM_STATUS[c.status]}>{NOME_STATUS[c.status]}</Badge>
          {c.contato.optOut && (
            <Badge tom="neutro">Pediu para não receber</Badge>
          )}
        </div>

        <p className="mt-0.5 truncate text-[13px] text-ink-500">
          {c.descricao} · {telefone(c.contato.telefone)}
        </p>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-500">
          <span
            className={cx(
              c.status === "vencido" && "font-medium text-rose-600",
            )}
          >
            {c.status === "pago" && c.pagoEm
              ? `Pago ${tempoRelativo(c.pagoEm)}`
              : `Vence ${dataCurta(c.vencimento)}`}
          </span>

          {c.reguaNome && (
            <span className="flex items-center gap-1">
              <Icon name="bolt" className="size-3 text-brand-500" />
              {c.reguaNome}
            </span>
          )}

          {c.tentativas > 0 && (
            <span>
              {c.tentativas} {c.tentativas === 1 ? "mensagem" : "mensagens"}{" "}
              {c.ultimoEnvioEm ? `· última ${tempoRelativo(c.ultimoEnvioEm)}` : ""}
            </span>
          )}

          {!encerrada && c.proximoDisparoEm && (
            <span className="text-brand-600">
              Próxima {prazoRelativo(c.proximoDisparoEm)}
            </span>
          )}
        </div>
      </div>

      <div className="shrink-0 text-right">
        <p
          className={cx(
            "text-sm font-semibold tabular-nums",
            c.status === "pago" ? "text-emerald-600" : "text-ink-900",
          )}
        >
          {valor}
        </p>
      </div>

      {verFinanceiro && (
        <AcoesCobranca
          cobrancaId={c.id}
          cliente={c.contato.nome}
          valor={valor}
          encerrada={encerrada}
        />
      )}
    </li>
  );
}

/* --------------------------------------------------------- Lista de réguas */

function ListaReguas({ reguas }: { reguas: ReguaResumo[] }) {
  if (reguas.length === 0) {
    return (
      <Card className="mt-5">
        <Vazio
          icone="bolt"
          titulo="Nenhuma régua criada"
          descricao="Uma régua é a sequência que persegue o pagamento: lembra três dias antes, cobra no vencimento e insiste depois — sem você lembrar de nada."
          acao={
            <Link
              href="/painel/cobranca/regua/nova"
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-700"
            >
              <Icon name="plus" className="size-4" />
              Criar minha primeira régua
            </Link>
          }
        />
      </Card>
    );
  }

  return (
    <div className="mt-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-500">
          A régua padrão entra sozinha em toda cobrança nova.
        </p>
        <Link
          href="/painel/cobranca/regua/nova"
          className="inline-flex h-9 items-center gap-2 rounded-xl bg-brand-600 px-3.5 text-[13px] font-medium text-white transition-colors hover:bg-brand-700"
        >
          <Icon name="plus" className="size-4" />
          Nova régua
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {reguas.map((r) => (
          <CardRegua key={r.id} regua={r} />
        ))}
      </div>
    </div>
  );
}

function CardRegua({ regua: r }: { regua: ReguaResumo }) {
  return (
    <Card className="relative p-5">
      <AcoesRegua
        reguaId={r.id}
        nome={r.nome}
        ativa={r.ativa}
        padrao={r.padrao}
        emAndamento={r.emAndamento}
      />

      <div className="pr-10">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/painel/cobranca/regua/${r.id}`}
            className="text-[15px] font-semibold text-ink-900 hover:text-brand-700"
          >
            {r.nome}
          </Link>
          {r.padrao && <Badge tom="info">Padrão</Badge>}
          <Badge tom={r.ativa ? "sucesso" : "neutro"}>
            {r.ativa ? "Ativa" : "Pausada"}
          </Badge>
        </div>

        {r.descricao && (
          <p className="mt-1 text-[13px] leading-relaxed text-ink-500">
            {r.descricao}
          </p>
        )}
      </div>

      <ul className="mt-4 space-y-1.5">
        {r.resumoEtapas.map((etapa, i) => (
          <li key={i} className="flex items-start gap-2 text-[13px] text-ink-600">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-400" />
            {etapa}
          </li>
        ))}
        {r.totalEtapas > r.resumoEtapas.length && (
          <li className="pl-3.5 text-[13px] text-ink-400">
            + {r.totalEtapas - r.resumoEtapas.length} etapa
            {r.totalEtapas - r.resumoEtapas.length === 1 ? "" : "s"}
          </li>
        )}
      </ul>

      <div className="mt-4 flex items-center justify-between border-t border-ink-100 pt-3.5 text-[13px]">
        <span className="text-ink-500">
          {r.aplicarA === "tag" && r.tag ? (
            <>
              Só para clientes marcados como{" "}
              <span className="font-medium text-ink-700">{r.tag}</span>
            </>
          ) : (
            "Vale para qualquer cliente"
          )}
        </span>
        <span
          className={cx(
            "font-medium",
            r.emAndamento > 0 ? "text-brand-600" : "text-ink-400",
          )}
        >
          {r.emAndamento > 0
            ? `${r.emAndamento} rodando agora`
            : "Ninguém na fila"}
        </span>
      </div>
    </Card>
  );
}
