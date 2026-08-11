import Link from "next/link";

import { Icon, type IconName } from "@/components/icons";
import { Pagina } from "@/components/shell";
import { Badge, Card, CardTitulo, Vazio } from "@/components/ui";
import { cx } from "@/lib/cx";
import { brl, dataLonga } from "@/lib/format";
import { painelCreditos, type FaturaDTO } from "@/server/dal/creditos";
import { carregarSessaoPainel } from "@/server/dal/painel";
import { centavosParaReais } from "@/server/dominio/dinheiro";
import { BotaoMudarPlano, SwitchRenovacao } from "./interacoes";

/**
 * Plano e faturas.
 *
 * Server Component: assinatura e histórico saem do banco com RLS ligado. O
 * protótipo lia `app.conta` do localStorage e as constantes de `lib/plans`,
 * então mostrava um plano Profissional para todo mundo — aqui o catálogo vem
 * das tabelas `plano` e `plano_preco`, e o pagamento só entra por webhook.
 */
export default async function CreditosPage({
  searchParams,
}: {
  searchParams: Promise<{ plano?: string | string[] }>;
}) {
  const sessao = await carregarSessaoPainel();

  /*
   * Atendente não vê dinheiro. A DAL recusaria de qualquer jeito
   * (`SemPermissaoError`), mas deixar estourar viraria tela de erro genérica em
   * vez de explicação.
   */
  if (!sessao.verFinanceiro) {
    return (
      <Pagina titulo="Plano e faturas">
        <Card>
          <Vazio
            icone="lock"
            titulo="Somente administradores"
            descricao="Plano e faturas ficam com quem administra a conta. Peça a quem te convidou se precisar de mudar algo."
          />
        </Card>
      </Pagina>
    );
  }

  const { plano: planoQuery } = await searchParams;
  const planoSugerido =
    typeof planoQuery === "string" ? planoQuery : (planoQuery?.[0] ?? null);

  const { assinatura, faturas, catalogo, precoConexaoExtra } = await painelCreditos();

  const planoAtual = catalogo.find((p) => p.id === assinatura.planoId) ?? null;

  return (
    <Pagina
      titulo="Plano e faturas"
      descricao="Sua assinatura e o histórico de pagamentos."
    >
      <div className="space-y-6">
        <Card>
          <CardTitulo
            titulo="Seu plano"
            subtitulo="O que está incluso na sua assinatura"
            acao={
              <BotaoMudarPlano
                catalogo={catalogo}
                planoAtualId={assinatura.planoId}
                periodicidadeAtual={assinatura.periodicidade}
                planoSugerido={planoSugerido}
                rotulo={planoAtual ? "Mudar de plano" : "Escolher plano"}
                variante={planoAtual ? "secundario" : "primario"}
              />
            }
          />

          {!planoAtual ? (
            <Vazio
              icone="spark"
              titulo="Nenhum plano ativo"
              descricao="Escolha um plano para a IA continuar atendendo, cobrando e agendando pelo seu WhatsApp."
            />
          ) : (
            <>
              <div className="grid gap-6 p-5 md:grid-cols-[1.1fr_1fr]">
                <div className="rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50 to-white p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium tracking-wide text-brand-600 uppercase">
                        Plano atual
                      </p>
                      <p className="mt-1 text-xl font-semibold text-ink-900">
                        {assinatura.planoNome}
                        <span className="ml-2 text-sm font-normal text-ink-500">
                          · {NOME_PERIODO[assinatura.periodicidade ?? ""] ?? "—"}
                        </span>
                      </p>
                    </div>
                    <StatusAssinatura status={assinatura.status} />
                  </div>

                  {/*
                   * Preço contratado, não o de tabela: quem assinou antes de um
                   * reajuste continua pagando o que combinou, e ver outro
                   * número aqui pareceria cobrança escondida.
                   */}
                  <p className="mt-3 text-2xl font-semibold text-ink-900">
                    {brl(
                      centavosParaReais(
                        assinatura.precoContratado /
                          MESES[assinatura.periodicidade ?? "mensal"],
                      ),
                    )}
                    <span className="text-sm font-normal text-ink-500">/mês</span>
                  </p>
                  <p className="mt-1 text-[13px] text-ink-500">
                    {brl(centavosParaReais(assinatura.precoContratado))} cobrado a
                    cada {MESES[assinatura.periodicidade ?? "mensal"]}{" "}
                    {MESES[assinatura.periodicidade ?? "mensal"] === 1
                      ? "mês"
                      : "meses"}
                  </p>

                  {assinatura.expiraEm && (
                    <p className="mt-3 text-[13px] text-ink-600">
                      {assinatura.status === "trial" ? "Teste até" : "Renova em"}{" "}
                      <strong className="font-medium">
                        {dataLonga(assinatura.expiraEm.toISOString())}
                      </strong>
                      {assinatura.diasParaExpirar !== null &&
                        (assinatura.diasParaExpirar >= 0
                          ? ` — faltam ${assinatura.diasParaExpirar} ${
                              assinatura.diasParaExpirar === 1 ? "dia" : "dias"
                            }`
                          : " — vencido")}
                    </p>
                  )}

                  {assinatura.conexoesExtras > 0 && (
                    <p className="mt-1 text-[13px] text-ink-500">
                      + {assinatura.conexoesExtras}{" "}
                      {assinatura.conexoesExtras === 1
                        ? "número extra"
                        : "números extras"}{" "}
                      ({brl(centavosParaReais(precoConexaoExtra))} cada por mês)
                    </p>
                  )}
                </div>

                <div>
                  <p className="mb-2 text-[13px] font-medium text-ink-700">
                    O que está incluso
                  </p>
                  <ul className="space-y-1.5">
                    {planoAtual.beneficios.map((b) => (
                      <li
                        key={b}
                        className="flex items-start gap-2 text-[13px] text-ink-600"
                      >
                        <Icon
                          name="check"
                          className="mt-0.5 size-3.5 shrink-0 text-brand-600"
                        />
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="px-5 pb-5">
                <SwitchRenovacao ativa={assinatura.renovacaoAutomatica} />
              </div>
            </>
          )}
        </Card>

        <Card>
          <CardTitulo
            titulo="Faturas"
            subtitulo="Histórico de pagamentos da sua conta"
          />
          {faturas.length === 0 ? (
            <Vazio
              icone="cash"
              titulo="Nenhuma fatura ainda"
              descricao="Assim que você contratar um plano ou comprar créditos, os pagamentos aparecem aqui."
            />
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
                  {faturas.map((f) => (
                    <LinhaFatura key={f.id} fatura={f} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </Pagina>
  );
}

/* ---------------------------------------------------------------- Peças */

const MESES: Record<string, number> = { mensal: 1, semestral: 6, anual: 12 };

const NOME_PERIODO: Record<string, string> = {
  mensal: "Mensal",
  semestral: "Semestral",
  anual: "Anual",
};

function StatusAssinatura({ status }: { status: string | null }) {
  if (status === "trial") return <Badge tom="info">Teste grátis</Badge>;
  if (status === "inadimplente") return <Badge tom="perigo">Em atraso</Badge>;
  if (status === "ativa") return <Badge tom="sucesso">Ativa</Badge>;
  return null;
}

const TIPO_TOM: Record<string, "marca" | "info" | "neutro"> = {
  assinatura: "marca",
  creditos: "info",
  conexao: "neutro",
};

const TIPO_NOME: Record<string, string> = {
  assinatura: "Assinatura",
  creditos: "Créditos",
  conexao: "Conexão extra",
};

const STATUS_FATURA: Record<string, { tom: "sucesso" | "aviso" | "perigo" | "neutro"; nome: string }> = {
  aprovado: { tom: "sucesso", nome: "Pago" },
  pendente: { tom: "aviso", nome: "Aguardando" },
  recusado: { tom: "perigo", nome: "Recusado" },
  estornado: { tom: "neutro", nome: "Estornado" },
  expirado: { tom: "neutro", nome: "Expirado" },
};

const METODO: Record<string, { icone: IconName; nome: string }> = {
  pix: { icone: "pix", nome: "PIX" },
  cartao: { icone: "card", nome: "Cartão" },
  boleto: { icone: "copy", nome: "Boleto" },
};

function LinhaFatura({ fatura }: { fatura: FaturaDTO }) {
  const status = STATUS_FATURA[fatura.status] ?? {
    tom: "neutro" as const,
    nome: fatura.status,
  };
  const metodo = METODO[fatura.metodo] ?? { icone: "cash" as IconName, nome: fatura.metodo };
  /* Data do pagamento quando pago; senão a da emissão — nunca uma data vazia. */
  const quando = fatura.pagoEm ?? fatura.criadoEm;

  return (
    <tr className="border-b border-ink-50 last:border-0">
      <td className="px-5 py-3 text-ink-800">{fatura.descricao}</td>
      <td className="px-5 py-3">
        <Badge tom={TIPO_TOM[fatura.tipo] ?? "neutro"}>
          {TIPO_NOME[fatura.tipo] ?? fatura.tipo}
        </Badge>
      </td>
      <td className="px-5 py-3 text-ink-500">{dataLonga(quando.toISOString())}</td>
      <td className="px-5 py-3 text-ink-500">
        <span className="inline-flex items-center gap-1.5">
          <Icon name={metodo.icone} className="size-3.5 text-ink-400" />
          {metodo.nome}
        </span>
      </td>
      <td className="px-5 py-3">
        <Badge tom={status.tom}>{status.nome}</Badge>
      </td>
      <td className="px-5 py-3 text-right font-medium text-ink-900">
        {brl(centavosParaReais(fatura.valor), true)}
      </td>
      <td className="px-5 py-3 text-right">
        {/*
         * Pendente vai para o checkout interno (que mostra o PIX e fica olhando
         * o status); pago vai para o comprovante do provedor. O protótipo tinha
         * um "Baixar recibo" que só mostrava um toast — botão que não faz nada
         * é pior que botão nenhum.
         */}
        {fatura.status === "pendente" ? (
          <Link
            href={`/painel/checkout/${fatura.id}`}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] font-medium text-brand-700 transition-colors hover:bg-brand-50"
          >
            Pagar
            <Icon name="arrowRight" className="size-3.5" />
          </Link>
        ) : fatura.ticketUrl ? (
          <a
            href={fatura.ticketUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] font-medium text-brand-700 transition-colors hover:bg-brand-50"
          >
            Comprovante
            <Icon name="arrowRight" className="size-3.5" />
          </a>
        ) : (
          <span className="text-xs text-ink-300">—</span>
        )}
      </td>
    </tr>
  );
}
