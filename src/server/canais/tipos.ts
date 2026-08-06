import "server-only";

/**
 * Contrato do canal de WhatsApp.
 *
 * O worker não sabe se por trás está a Cloud API oficial da Meta ou a Evolution
 * API. Isso importa porque a decisão de qual usar depende do cliente (número
 * oficial verificado vs. número pessoal já em uso) e vai mudar durante a vida
 * do produto. Um adaptador falso implementa esta mesma interface nos testes.
 *
 * Duas camadas de propósito:
 *
 *   CanalWhatsApp → o que o worker enxerga. Fala em `orgId` e no id interno do
 *                   template; não conhece token nem URL.
 *   Provedor      → o que cada API fala. Recebe credenciais já decifradas e o
 *                   nome do template como a Meta espera. Não toca no banco.
 *
 * A fábrica (`fabrica.ts`) é a ponte: resolve organização → credenciais e
 * template interno → nome/idioma, e só então chama o provedor.
 */

export interface EnvioTexto {
  orgId: string;
  para: string;
  texto: string;
  /** Chave de idempotência: o id do disparo. Reenvio não duplica mensagem. */
  idempotencia: string;
}

export interface EnvioTemplate {
  orgId: string;
  para: string;
  /** id interno (template_whatsapp.id), não o nome na Meta. */
  templateId: string;
  parametros: string[];
  idempotencia: string;
}

export type ResultadoEnvio =
  | {
      ok: true;
      /** id da mensagem no provedor (wamid...), para casar com o webhook. */
      provedorId: string;
      conteudo: string;
    }
  | {
      ok: false;
      erro: string;
      /**
       * Erro transitório (rede, 429, 5xx) → vale repetir.
       * Erro permanente (número inválido, template reprovado) → não adianta.
       */
      retentar: boolean;
      /** Código do provedor, quando houver — vai para `disparo.ultimo_erro`. */
      codigo?: string;
    };

export interface CanalWhatsApp {
  enviarTexto(envio: EnvioTexto): Promise<ResultadoEnvio>;
  enviarTemplate(envio: EnvioTemplate): Promise<ResultadoEnvio>;
}

// ---------------------------------------------------------------------------
// Camada de provedor
// ---------------------------------------------------------------------------

export type ProvedorCanal = "meta_cloud" | "evolution";

/**
 * Credenciais já decifradas. Este objeto nunca é logado nem serializado: quem
 * o recebe usa e descarta. `token` é segredo de portador — quem tiver ele
 * manda mensagem em nome do cliente.
 */
export interface Credenciais {
  provedor: ProvedorCanal;
  canalId: string;
  token: string;
  /** Cloud API: id do número na Meta. */
  phoneNumberId?: string | null;
  /** Evolution: URL da instância e nome dela. */
  baseUrl?: string | null;
  instancia?: string | null;
}

export interface TextoProvedor {
  para: string;
  texto: string;
}

export interface TemplateProvedor {
  para: string;
  /** Nome snake_case aprovado na Meta. */
  nome: string;
  idioma: string;
  parametros: string[];
  /** Corpo já preenchido — guardamos ele como conteúdo da mensagem. */
  previa: string;
}

/**
 * Resposta do "esse token funciona mesmo?".
 *
 * Existe porque credencial errada é a falha mais provável na hora de conectar,
 * e a pior de descobrir tarde: sem esta chamada, o canal entra como conectado,
 * a régua agenda, e só às 09:00 do dia seguinte alguém percebe que nada saiu.
 */
export type ResultadoVerificacao =
  | {
      ok: true;
      /** Nome/número como o provedor conhece — a tela confirma visualmente. */
      numero?: string | null;
      nomeExibicao?: string | null;
      /** Cloud API: GREEN | YELLOW | RED. */
      qualidade?: string | null;
      limiteDiario?: number | null;
    }
  | { ok: false; erro: string; codigo?: string };

export interface Provedor {
  enviarTexto(cred: Credenciais, envio: TextoProvedor): Promise<ResultadoEnvio>;
  enviarTemplate(
    cred: Credenciais,
    envio: TemplateProvedor,
  ): Promise<ResultadoEnvio>;
  /** Chamada barata e sem efeito colateral só para validar as credenciais. */
  verificar(cred: Credenciais): Promise<ResultadoVerificacao>;
}

/** Falha de rede/timeout tem a mesma resposta em qualquer provedor. */
export function falhaDeRede(erro: unknown): Extract<ResultadoEnvio, { ok: false }> {
  const e = erro as { name?: string; message?: string };
  const timeout = e?.name === "TimeoutError" || e?.name === "AbortError";
  return {
    ok: false,
    erro: timeout ? "timeout ao falar com o provedor" : `rede: ${e?.message ?? String(erro)}`,
    retentar: true,
    codigo: timeout ? "timeout" : "rede",
  };
}
