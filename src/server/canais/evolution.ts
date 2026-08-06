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
 * Adaptador da Evolution API (WhatsApp não-oficial, número pessoal do cliente).
 *
 * Existe porque a maioria dos clientes pequenos já usa o próprio número no
 * celular e não vai passar pela verificação de negócio da Meta só para testar o
 * produto. O preço disso está documentado aqui e é dito ao cliente na tela de
 * conexão: número pessoal pode ser bloqueado pela Meta, e a régua fica muda até
 * ele reconectar.
 */

const TIMEOUT_MS = 15_000;

interface RespostaEvolution {
  key?: { id?: string };
  error?: string;
  response?: { message?: string | string[] };
}

function destino(e164: string): string {
  return e164.replace(/\D/g, "");
}

function mensagemDeErro(json: RespostaEvolution, status: number): string {
  const m = json.response?.message;
  if (Array.isArray(m)) return m.join("; ");
  return String(m ?? json.error ?? `HTTP ${status}`);
}

async function enviarTextoCru(
  cred: Credenciais,
  para: string,
  texto: string,
): Promise<ResultadoEnvio> {
  if (!cred.baseUrl || !cred.instancia) {
    return {
      ok: false,
      erro: "canal Evolution sem base_url/instancia",
      retentar: false,
      codigo: "config",
    };
  }

  const url =
    `${cred.baseUrl.replace(/\/+$/, "")}` +
    `/message/sendText/${encodeURIComponent(cred.instancia)}`;

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { apikey: cred.token, "Content-Type": "application/json" },
      body: JSON.stringify({ number: destino(para), text: texto }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });

    const json = (await resp.json().catch(() => ({}))) as RespostaEvolution;

    if (resp.status >= 400) {
      return {
        ok: false,
        erro: mensagemDeErro(json, resp.status),
        // 401/403 = apikey errada; 404 = instância sumiu. Nesses casos repetir
        // não resolve — alguém precisa reconectar o número na tela de canais.
        retentar: resp.status >= 500 || resp.status === 429,
        codigo: String(resp.status),
      };
    }

    const id = json.key?.id;
    if (!id) {
      return {
        ok: false,
        erro: "instância respondeu sem id de mensagem",
        retentar: true,
        codigo: "sem_id",
      };
    }

    return { ok: true, provedorId: id, conteudo: texto };
  } catch (erro) {
    return falhaDeRede(erro);
  }
}

export const evolution: Provedor = {
  /**
   * `connectionState` diz se a instância está pareada com o celular. É o teste
   * que importa: token certo com celular desconectado responde 200 e mesmo
   * assim não manda nada — o caso clássico de "estava funcionando ontem",
   * depois que o cliente desligou o aparelho ou saiu do WhatsApp Web.
   */
  async verificar(cred: Credenciais) {
    if (!cred.baseUrl || !cred.instancia) {
      return { ok: false as const, erro: "informe a URL da instância e o nome dela", codigo: "config" };
    }

    const url =
      `${cred.baseUrl.replace(/\/+$/, "")}` +
      `/instance/connectionState/${encodeURIComponent(cred.instancia)}`;

    try {
      const resp = await fetch(url, {
        headers: { apikey: cred.token },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });

      const json = (await resp.json().catch(() => ({}))) as RespostaEvolution & {
        instance?: { state?: string; owner?: string; profileName?: string };
      };

      if (resp.status === 401 || resp.status === 403) {
        return { ok: false as const, erro: "chave da API recusada pela instância", codigo: "auth" };
      }
      if (resp.status === 404) {
        return { ok: false as const, erro: `instância "${cred.instancia}" não existe nessa URL`, codigo: "404" };
      }
      if (resp.status >= 400) {
        return { ok: false as const, erro: mensagemDeErro(json, resp.status), codigo: String(resp.status) };
      }

      const estado = json.instance?.state;
      if (estado !== "open") {
        return {
          ok: false as const,
          erro:
            estado === "connecting"
              ? "a instância ainda está pareando — leia o QR Code no celular e tente de novo"
              : "a instância está desconectada do celular",
          codigo: estado ?? "sem_estado",
        };
      }

      return {
        ok: true as const,
        // `owner` vem como "5511999999999@s.whatsapp.net".
        numero: json.instance?.owner?.split("@")[0] ?? null,
        nomeExibicao: json.instance?.profileName ?? null,
      };
    } catch (erro) {
      const f = falhaDeRede(erro);
      return { ok: false as const, erro: f.erro, codigo: f.codigo };
    }
  },

  async enviarTexto(cred: Credenciais, envio: TextoProvedor) {
    return enviarTextoCru(cred, envio.para, envio.texto);
  },

  /**
   * Evolution não tem template aprovado nem janela de 24h — é o WhatsApp comum.
   * Mandamos o corpo já preenchido. A consequência real: sem a proteção da
   * janela, uma régua mal configurada vira spam e derruba o número. Por isso o
   * worker continua respeitando expediente e opt-out mesmo aqui.
   */
  async enviarTemplate(cred: Credenciais, envio: TemplateProvedor) {
    return enviarTextoCru(cred, envio.para, envio.previa);
  },
};
