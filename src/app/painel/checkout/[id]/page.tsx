import Link from "next/link";
import { notFound } from "next/navigation";

import { Icon } from "@/components/icons";
import { Pagina } from "@/components/shell";
import { Badge, Botao, Card, Vazio } from "@/components/ui";
import { brl, dataHora } from "@/lib/format";
import { buscarPagamento } from "@/server/dal/creditos";
import { carregarSessaoPainel } from "@/server/dal/painel";
import { centavosParaReais } from "@/server/dominio/dinheiro";
import { Aguardando, CodigoPix } from "./interacoes";

/**
 * Checkout de um pagamento já criado.
 *
 * A tela é a **leitura** de uma linha de `pagamento`: quem cria é a ação de
 * contratar plano/comprar pacote, e quem confirma é o webhook do provedor.
 * Nada aqui libera crédito nem troca plano — a página só mostra o PIX e fica
 * olhando o status.
 *
 * Ficava em `/checkout` como página client que lia plano e preço de
 * `lib/plans` + localStorage, com QR desenhado por hash do id: mostrava
 * "pagamento confirmado" sem ninguém ter pago. Agora mora dentro de `/painel`,
 * atrás do guard de sessão, porque pagamento é dado de tenant e o id na URL só
 * abre para a organização dona dele.
 */

const TOM = {
  pendente: "aviso",
  pago: "sucesso",
  cancelado: "neutro",
  estornado: "neutro",
  falhou: "perigo",
} as const;

const ROTULO: Record<string, string> = {
  pendente: "Aguardando pagamento",
  pago: "Pago",
  cancelado: "Cancelado",
  estornado: "Estornado",
  falhou: "Não autorizado",
};

export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sessao = await carregarSessaoPainel();

  if (!sessao.verFinanceiro) {
    return (
      <Pagina titulo="Pagamento">
        <Card>
          <Vazio
            icone="lock"
            titulo="Somente administradores"
            descricao="Pagamentos ficam com quem administra a conta."
          />
        </Card>
      </Pagina>
    );
  }

  const pagamento = await buscarPagamento(id);
  if (!pagamento) notFound();

  const pendente = pagamento.status === "pendente";
  const tom = TOM[pagamento.status as keyof typeof TOM] ?? "neutro";

  return (
    <Pagina
      titulo="Pagamento"
      descricao={pagamento.descricao}
      acao={
        <Link href="/painel/creditos">
          <Botao variante="secundario" icone="chevronLeft">
            Voltar para plano e créditos
          </Botao>
        </Link>
      }
    >
      <div className="mx-auto max-w-lg space-y-4">
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[13px] text-ink-500">Valor</p>
              <p className="mt-0.5 text-2xl font-semibold text-ink-900">
                {brl(centavosParaReais(pagamento.valor), true)}
              </p>
            </div>
            <Badge tom={tom}>{ROTULO[pagamento.status] ?? pagamento.status}</Badge>
          </div>

          <dl className="mt-4 space-y-1.5 border-t border-ink-100 pt-4 text-[13px]">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-500">Criado em</dt>
              <dd className="text-ink-700">
                {dataHora(pagamento.criadoEm.toISOString())}
              </dd>
            </div>
            {pagamento.pagoEm && (
              <div className="flex justify-between gap-4">
                <dt className="text-ink-500">Pago em</dt>
                <dd className="text-ink-700">
                  {dataHora(pagamento.pagoEm.toISOString())}
                </dd>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <dt className="text-ink-500">Método</dt>
              <dd className="text-ink-700 uppercase">{pagamento.metodo}</dd>
            </div>
          </dl>
        </Card>

        {pendente && (
          <Card className="space-y-4 p-5">
            {pagamento.pixCopiaCola ? (
              <>
                {pagamento.qrBase64 && (
                  <div className="flex justify-center">
                    {/*
                      QR vem do provedor em base64: <img> normal, sem
                      next/image, porque não há URL para otimizar.
                    */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`data:image/png;base64,${pagamento.qrBase64}`}
                      alt="QR Code do PIX"
                      className="size-56 rounded-xl border border-ink-200"
                    />
                  </div>
                )}
                <CodigoPix codigo={pagamento.pixCopiaCola} />
              </>
            ) : (
              <div className="flex items-start gap-3 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200 ring-inset">
                <Icon name="alert" className="mt-0.5 size-4 shrink-0 text-amber-600" />
                <div className="text-[13px] leading-relaxed text-amber-800">
                  <p className="font-medium">PIX ainda não emitido.</p>
                  <p className="mt-1 text-amber-700">
                    O provedor de pagamento não está conectado neste ambiente,
                    então o código não foi gerado. O pagamento fica registrado
                    como pendente e some do caminho quando expirar.
                  </p>
                </div>
              </div>
            )}

            <Aguardando expiraEm={pagamento.expiraEm?.toISOString() ?? null} />

            {pagamento.ticketUrl && (
              <a
                href={pagamento.ticketUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-brand-700 hover:underline"
              >
                Abrir no provedor
                <Icon name="arrowRight" className="size-3.5" />
              </a>
            )}
          </Card>
        )}

        {pagamento.status === "pago" && (
          <Card className="p-5">
            <div className="flex items-start gap-3">
              <Icon name="check" className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              <p className="text-[13px] leading-relaxed text-ink-600">
                Pagamento confirmado. O que foi comprado já está valendo na sua
                conta — plano e saldo aparecem em{" "}
                <Link href="/painel/creditos" className="font-medium text-brand-700 hover:underline">
                  Plano e créditos
                </Link>
                .
              </p>
            </div>
          </Card>
        )}
      </div>
    </Pagina>
  );
}
