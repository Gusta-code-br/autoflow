import "server-only";

import {
  falhaDeRede,
  type Credenciais,
  type Provedor,
  type ResultadoEnvio,
  type TemplateProvedor,
  type TextoProvedor,
} from "./tipos";

/**
 * Adaptador da WhatsApp Cloud API (Meta).
 *
 * Só HTTP: não abre transação, não lê env de tenant, não loga token. Quem
 * chama já trouxe as credenciais decifradas.
 */

const VERSAO_API = process.env.META_API_VERSION ?? "v21.0";
const BASE = process.env.META_API_BASE ?? "https://graph.facebook.com";
const TIMEOUT_MS = 15_000;

/**
 * A Meta quer só dígitos, sem "+". Guardamos E.164 no banco (com "+") porque é
 * o formato canônico; a conversão fica na borda, não no domínio.
 */
function paraDestino(e164: string): string {
  return e164.replace(/\D/g, "");
}

interface RespostaOk {
  messages?: { id: string }[];
}

interface RespostaErro {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    error_data?: { details?: string };
  };
}

/**
 * Quais erros vale repetir.
 *
 * O critério não é acadêmico: repetir um erro permanente queima tentativa,
 * atrasa a fila e, nos casos de spam-rate (131048), piora a reputação do
 * número. Repetir um transitório evita perder cobrança por soluço de rede.
 *
 * 130429 → rate limit da conta        (transitório, respeita backoff)
 * 131056 → par remetente/destinatário em throttle (transitório)
 * 133016 → conta em manutenção        (transitório)
 * 131047 → fora da janela de 24h      (permanente: precisa de template)
 * 131048 → limite de spam atingido    (permanente para este disparo)
 * 131026 → destinatário não recebe    (número sem WhatsApp)
 * 132xxx → template inválido/reprovado
 * 190    → token expirado             (permanente até reconectar o canal)
 */
const CODIGOS_TRANSITORIOS = new Set([130429, 131056, 133016, 368, 80007, 1, 2]);

function classificar(
  status: number,
  corpo: RespostaErro,
): Extract<ResultadoEnvio, { ok: false }> {
  const err = corpo.error;
  const codigo = err?.code;
  const detalhe = err?.error_data?.details ?? err?.message ?? `HTTP ${status}`;

  // 5xx é do lado deles; 429 é fila cheia. Ambos passam.
  const transitorio =
    status >= 500 ||
    status === 429 ||
    (codigo !== undefined && CODIGOS_TRANSITORIOS.has(codigo));

  return {
    ok: false,
    erro: detalhe,
    retentar: transitorio,
    codigo: codigo !== undefined ? String(codigo) : String(status),
  };
}

async function postar(
  cred: Credenciais,
  corpo: unknown,
): Promise<{ status: number; json: RespostaOk & RespostaErro }> {
  const url = `${BASE}/${VERSAO_API}/${cred.phoneNumberId}/messages`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cred.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    // Envio nunca pode ser servido de cache. O Next intercepta `fetch`.
    cache: "no-store",
  });

  const json = (await resp.json().catch(() => ({}))) as RespostaOk & RespostaErro;
  return { status: resp.status, json };
}

/** "TIER_1K" → 1000; "TIER_UNLIMITED" → null (sem teto conhecido). */
function tierParaNumero(tier: string | undefined): number | null {
  if (!tier) return null;
  const m = /^TIER_(\d+)(K|M)?$/.exec(tier);
  if (!m) return null;
  const base = Number(m[1]);
  const escala = m[2] === "M" ? 1_000_000 : m[2] === "K" ? 1_000 : 1;
  return base * escala;
}

function idDaResposta(json: RespostaOk): string | null {
  return json.messages?.[0]?.id ?? null;
}

export const cloudApi: Provedor = {
  /**
   * GET no próprio número. Serve de teste de credencial e ainda traz o tier de
   * mensagens e a nota de qualidade — os dois números que explicam, depois,
   * por que a Meta começou a recusar envio.
   */
  async verificar(cred: Credenciais) {
    if (!cred.phoneNumberId) {
      return { ok: false as const, erro: "informe o ID do número (phone number ID)", codigo: "config" };
    }

    try {
      const url =
        `${BASE}/${VERSAO_API}/${cred.phoneNumberId}` +
        `?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier`;

      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${cred.token}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });

      const json = (await resp.json().catch(() => ({}))) as RespostaErro & {
        display_phone_number?: string;
        verified_name?: string;
        quality_rating?: string;
        messaging_limit_tier?: string;
      };

      if (resp.status >= 400) {
        const c = classificar(resp.status, json);
        // 401 = token recusado; 404 = phone_number_id não existe pra esse
        // token. `codigo` casa com o `name` do input no formulário de conexão
        // aqui (diferente de `enviarTexto`/`enviarTemplate`, onde `codigo`
        // decide retry — por isso o mapeamento fica só neste método).
        const campo =
          resp.status === 401 ? "token" : resp.status === 404 ? "phoneNumberId" : undefined;
        return { ok: false as const, erro: c.erro, codigo: campo ?? c.codigo };
      }

      return {
        ok: true as const,
        numero: json.display_phone_number ?? null,
        nomeExibicao: json.verified_name ?? null,
        qualidade: json.quality_rating ?? null,
        // "TIER_1K" → 1000. O tier é o que a Meta deixa mandar por dia.
        limiteDiario: tierParaNumero(json.messaging_limit_tier),
      };
    } catch (erro) {
      const f = falhaDeRede(erro);
      return { ok: false as const, erro: f.erro, codigo: f.codigo };
    }
  },

  async enviarTexto(cred: Credenciais, envio: TextoProvedor) {
    if (!cred.phoneNumberId) {
      return {
        ok: false,
        erro: "canal sem phone_number_id configurado",
        retentar: false,
        codigo: "config",
      };
    }

    try {
      const { status, json } = await postar(cred, {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: paraDestino(envio.para),
        type: "text",
        // preview_url ligado transformaria link de pagamento em card e mudaria
        // a altura da mensagem no aparelho; não vale o risco de layout.
        text: { preview_url: false, body: envio.texto },
      });

      if (status >= 400) return classificar(status, json);

      const id = idDaResposta(json);
      if (!id) {
        return {
          ok: false,
          erro: "provedor respondeu 200 sem id de mensagem",
          retentar: true,
          codigo: "sem_id",
        };
      }

      return { ok: true, provedorId: id, conteudo: envio.texto };
    } catch (erro) {
      return falhaDeRede(erro);
    }
  },

  async enviarTemplate(cred: Credenciais, envio: TemplateProvedor) {
    if (!cred.phoneNumberId) {
      return {
        ok: false,
        erro: "canal sem phone_number_id configurado",
        retentar: false,
        codigo: "config",
      };
    }

    try {
      const componentes =
        envio.parametros.length > 0
          ? [
              {
                type: "body",
                parameters: envio.parametros.map((text) => ({
                  type: "text",
                  text,
                })),
              },
            ]
          : [];

      const { status, json } = await postar(cred, {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: paraDestino(envio.para),
        type: "template",
        template: {
          name: envio.nome,
          language: { code: envio.idioma },
          components: componentes,
        },
      });

      if (status >= 400) return classificar(status, json);

      const id = idDaResposta(json);
      if (!id) {
        return {
          ok: false,
          erro: "provedor respondeu 200 sem id de mensagem",
          retentar: true,
          codigo: "sem_id",
        };
      }

      return { ok: true, provedorId: id, conteudo: envio.previa };
    } catch (erro) {
      return falhaDeRede(erro);
    }
  },
};

/** Exportado só para o teste: a classificação é a parte que erra mais. */
export const _classificar = classificar;
export const _paraDestino = paraDestino;
