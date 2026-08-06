import type {
  CanalWhatsApp,
  EnvioTemplate,
  EnvioTexto,
  ResultadoEnvio,
} from "./tipos";

/**
 * Canal falso: guarda os envios numa lista em memória.
 *
 * Usado nos testes e no `dev` sem WhatsApp conectado. Sem isso, testar a régua
 * exigiria número real, e ninguém roda um teste que manda mensagem de cobrança
 * para gente de verdade duas vezes.
 *
 * Não tem "server-only": o teste roda fora do bundle do Next.
 */

export interface EnvioRegistrado {
  tipo: "texto" | "template";
  orgId: string;
  para: string;
  conteudo: string;
  templateId?: string;
  parametros?: string[];
  idempotencia: string;
  em: Date;
}

export interface CanalFalso extends CanalWhatsApp {
  readonly caixa: EnvioRegistrado[];
  /** Faz o próximo envio falhar com este resultado. Fila: um por chamada. */
  falharProximo(resultado: Extract<ResultadoEnvio, { ok: false }>): void;
  limpar(): void;
}

export function criarCanalFalso(): CanalFalso {
  const caixa: EnvioRegistrado[] = [];
  const falhas: Extract<ResultadoEnvio, { ok: false }>[] = [];
  let sequencia = 0;

  function proximoId(): string {
    sequencia += 1;
    return `wamid.FALSO${String(sequencia).padStart(4, "0")}`;
  }

  return {
    caixa,

    falharProximo(resultado) {
      falhas.push(resultado);
    },

    limpar() {
      caixa.length = 0;
      falhas.length = 0;
      sequencia = 0;
    },

    async enviarTexto(envio: EnvioTexto): Promise<ResultadoEnvio> {
      const falha = falhas.shift();
      if (falha) return falha;

      // Idempotência de verdade: mesmo disparo reenviado devolve o mesmo id
      // sem duplicar a caixa. É assim que o provedor real se comporta quando o
      // worker morre entre o envio e o commit.
      const jaEnviado = caixa.find((e) => e.idempotencia === envio.idempotencia);
      if (jaEnviado) {
        return { ok: true, provedorId: `wamid.REPETIDO`, conteudo: jaEnviado.conteudo };
      }

      caixa.push({
        tipo: "texto",
        orgId: envio.orgId,
        para: envio.para,
        conteudo: envio.texto,
        idempotencia: envio.idempotencia,
        em: new Date(),
      });

      return { ok: true, provedorId: proximoId(), conteudo: envio.texto };
    },

    async enviarTemplate(envio: EnvioTemplate): Promise<ResultadoEnvio> {
      const falha = falhas.shift();
      if (falha) return falha;

      const conteudo = `[template ${envio.templateId}] ${envio.parametros.join(" | ")}`;

      const jaEnviado = caixa.find((e) => e.idempotencia === envio.idempotencia);
      if (jaEnviado) {
        return { ok: true, provedorId: `wamid.REPETIDO`, conteudo: jaEnviado.conteudo };
      }

      caixa.push({
        tipo: "template",
        orgId: envio.orgId,
        para: envio.para,
        conteudo,
        templateId: envio.templateId,
        parametros: envio.parametros,
        idempotencia: envio.idempotencia,
        em: new Date(),
      });

      return { ok: true, provedorId: proximoId(), conteudo };
    },
  };
}
