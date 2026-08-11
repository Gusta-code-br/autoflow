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
  message?: string | string[];
  response?: { message?: string | string[] };
}

function destino(e164: string): string {
  return e164.replace(/\D/g, "");
}

// Instâncias self-hosted de clientes diferentes rodam versões diferentes da
// Evolution API, e cada uma devolve erro num formato ligeiramente distinto
// (v2 costuma aninhar em `response.message`, outras mandam `message` ou
// `error` na raiz). Tenta todos antes de cair no HTTP genérico, senão o
// cliente só vê "HTTP 400" sem saber o que corrigir.
function mensagemDeErro(json: RespostaEvolution, status: number): string {
  const candidatos = [json.response?.message, json.message, json.error];
  for (const c of candidatos) {
    if (Array.isArray(c) && c.length > 0) return c.map(String).join("; ");
    if (typeof c === "string" && c.trim()) return c;
  }
  return `HTTP ${status}`;
}

// Erro comum de configuração: o cliente cola a URL do painel web da Evolution
// (que costuma terminar em `/manager`) em vez da URL raiz da API. Normaliza
// para não gerar rotas do tipo `/manager/message/sendText/...`, que não
// existem.
function normalizarBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "").replace(/\/manager$/i, "");
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
    `${normalizarBaseUrl(cred.baseUrl)}` +
    `/message/sendText/${encodeURIComponent(cred.instancia)}`;
  const numero = destino(para);

  const enviar = (body: unknown) =>
    fetch(url, {
      method: "POST",
      headers: { apikey: cred.token, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });

  try {
    let resp = await enviar({ number: numero, text: texto });
    let json = (await resp.json().catch(() => ({}))) as RespostaEvolution;

    // Formato do corpo mudou entre versões da Evolution API: v2 aceita
    // `{ number, text }`, versões mais antigas (v1) exigem `{ number,
    // textMessage: { text } }` e rejeitam o formato novo com 400. Como o
    // cliente aponta para uma instância self-hosted própria, não dá para
    // saber a versão de antemão — tenta o formato antigo antes de desistir.
    if (resp.status === 400) {
      const respAntiga = await enviar({ number: numero, textMessage: { text: texto } });
      if (respAntiga.status < 400) {
        resp = respAntiga;
        json = (await respAntiga.json().catch(() => ({}))) as RespostaEvolution;
      }
    }

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
      `${normalizarBaseUrl(cred.baseUrl)}` +
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
        // `codigo` casa com o `name` do input no formulário de conexão — é o
        // que faz o erro acender embaixo do campo certo em vez de só um aviso
        // genérico no topo. Ver `CAMPO_POR_CODIGO` em actions/conexoes.ts.
        return { ok: false as const, erro: "chave da API recusada pela instância", codigo: "token" };
      }
      if (resp.status === 404) {
        return {
          ok: false as const,
          erro: `instância "${cred.instancia}" não existe nessa URL`,
          codigo: "instancia",
        };
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
