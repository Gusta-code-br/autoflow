import "server-only";

/**
 * Cliente do Mercado Pago para os pagamentos que o próprio AutoFlow recebe
 * (assinatura do painel, pacote de créditos, conexão extra) — usa a conta
 * mercado-pago DO AUTOFLOW (`MERCADOPAGO_ACCESS_TOKEN`), não a do tenant.
 *
 * A conta do tenant (`integracao_mp`, OAuth, para cobrar o CLIENTE DELE) é um
 * fluxo separado e não passa por aqui.
 *
 * Por que REST cru em vez do SDK oficial: o SDK node do Mercado Pago traz
 * `axios` + tipos gigantes para três chamadas HTTP. `fetch` nativo já resolve
 * e mantém o bundle do worker enxuto.
 */

const BASE_URL = "https://api.mercadopago.com";

export class ErroConfigPagamento extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ErroConfigPagamento";
  }
}

/** Erro devolvido pela API do Mercado Pago (não é problema de configuração). */
export class ErroMercadoPago extends Error {
  constructor(
    msg: string,
    public readonly status: number,
    public readonly corpo: unknown,
  ) {
    super(msg);
    this.name = "ErroMercadoPago";
  }
}

/** `false` = segue no modo simulado (sem PIX real) em vez de quebrar o checkout. */
export function mercadoPagoConfigurado(): boolean {
  return Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN);
}

function accessToken(): string {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) throw new ErroConfigPagamento("MERCADOPAGO_ACCESS_TOKEN não configurado");
  return token;
}

export interface PixCriado {
  mpPaymentId: string;
  status: string;
  statusDetail: string | null;
  /** O `pagamento.id` nosso, mandado na criação — é como o webhook casa o evento. */
  externalReference: string | null;
  pixCopiaCola: string | null;
  qrBase64: string | null;
  ticketUrl: string | null;
  expiraEm: Date | null;
}

interface RespostaPagamentoMp {
  id: number;
  status: string;
  status_detail: string | null;
  external_reference: string | null;
  date_of_expiration: string | null;
  point_of_interaction?: {
    transaction_data?: {
      qr_code?: string;
      qr_code_base64?: string;
      ticket_url?: string;
    };
  };
}

/**
 * Cria uma cobrança PIX no Mercado Pago para a organização pagar o AutoFlow.
 *
 * `idempotencyKey` é o `pagamento.id` (uuid gerado na hora do INSERT, antes
 * desta chamada): se a requisição cair no meio do caminho e o Next tentar de
 * novo, o Mercado Pago devolve o MESMO pagamento em vez de cobrar duas vezes.
 */
export async function criarPixMercadoPago(entrada: {
  valorCentavos: number;
  descricao: string;
  externalReference: string;
  payerEmail: string;
  idempotencyKey: string;
}): Promise<PixCriado> {
  const resp = await fetch(`${BASE_URL}/v1/payments`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken()}`,
      "x-idempotency-key": entrada.idempotencyKey,
    },
    body: JSON.stringify({
      transaction_amount: entrada.valorCentavos / 100,
      description: entrada.descricao,
      payment_method_id: "pix",
      external_reference: entrada.externalReference,
      payer: { email: entrada.payerEmail },
      notification_url: urlNotificacao(),
    }),
  });

  const corpo = (await resp.json()) as RespostaPagamentoMp & { message?: string };
  if (!resp.ok) {
    throw new ErroMercadoPago(
      corpo.message ?? `Mercado Pago recusou a cobrança (HTTP ${resp.status})`,
      resp.status,
      corpo,
    );
  }

  return normalizar(corpo);
}

/** Consulta o estado atual de um pagamento — usado pelo cron de recuperação. */
export async function consultarPagamentoMercadoPago(mpPaymentId: string): Promise<PixCriado> {
  const resp = await fetch(`${BASE_URL}/v1/payments/${mpPaymentId}`, {
    headers: { authorization: `Bearer ${accessToken()}` },
  });

  const corpo = (await resp.json()) as RespostaPagamentoMp & { message?: string };
  if (!resp.ok) {
    throw new ErroMercadoPago(
      corpo.message ?? `Mercado Pago recusou a consulta (HTTP ${resp.status})`,
      resp.status,
      corpo,
    );
  }

  return normalizar(corpo);
}

function normalizar(corpo: RespostaPagamentoMp): PixCriado {
  const dados = corpo.point_of_interaction?.transaction_data;
  return {
    mpPaymentId: String(corpo.id),
    status: corpo.status,
    statusDetail: corpo.status_detail,
    externalReference: corpo.external_reference ?? null,
    pixCopiaCola: dados?.qr_code ?? null,
    qrBase64: dados?.qr_code_base64 ?? null,
    ticketUrl: dados?.ticket_url ?? null,
    expiraEm: corpo.date_of_expiration ? new Date(corpo.date_of_expiration) : null,
  };
}

/**
 * Sem `APP_URL` configurado (dev local sem túnel), a criação do PIX ainda
 * funciona — só não chega notificação automática; o cron de recuperação supre.
 */
function urlNotificacao(): string | undefined {
  const base = process.env.APP_URL;
  if (!base || base.includes("localhost")) return undefined;
  return `${base}/api/webhooks/mercadopago`;
}
