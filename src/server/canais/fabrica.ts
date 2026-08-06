import "server-only";

import { sql, type Transacao } from "@/server/db";
import {
  cifrar,
  decifrar,
  gerarToken,
  versaoAtual,
} from "@/server/seguranca/cripto";

import { cloudApi } from "./cloud-api";
import { evolution } from "./evolution";
import {
  type CanalWhatsApp,
  type Credenciais,
  type EnvioTemplate,
  type EnvioTexto,
  type Provedor,
  type ProvedorCanal,
  type ResultadoEnvio,
  type ResultadoVerificacao,
} from "./tipos";

/**
 * Resolve organização → canal conectado → provedor certo, e mantém o worker
 * ignorante sobre credenciais.
 *
 * O worker processa um lote com disparos de várias organizações misturadas.
 * Se ele tivesse que carregar um canal por org antes de começar, ou o lote
 * viraria por-org (perdendo o SKIP LOCKED global) ou ele guardaria tokens de
 * todos os clientes na memória. Aqui a resolução é por envio e o token vive só
 * dentro da chamada.
 */

const PROVEDORES: Record<ProvedorCanal, Provedor> = {
  meta_cloud: cloudApi,
  evolution,
};

interface LinhaCanal {
  id: string;
  provedor: ProvedorCanal;
  phone_number_id: string | null;
  base_url: string | null;
  instancia: string | null;
  token_cif: string | null;
}

interface LinhaTemplate {
  nome: string;
  idioma: string;
  corpo: string;
  variaveis_map: Record<string, string> | null;
  status: string;
}

function semCanal(motivo: string): ResultadoEnvio {
  return { ok: false, erro: motivo, retentar: false, codigo: "canal" };
}

/**
 * Cache de credenciais por organização.
 *
 * Sem cache, um lote de 100 disparos da mesma org faz 100 SELECTs e 100
 * decifragens AES. Com TTL curto: se o cliente reconectar o número ou a gente
 * revogar um token, o worker para de usar o antigo em no máximo 30s — tempo
 * curto o bastante para não virar incidente e longo o bastante para valer.
 */
const TTL_MS = 30_000;
const cache = new Map<string, { em: number; cred: Credenciais | null }>();

async function credenciaisDaOrg(orgId: string): Promise<Credenciais | null> {
  const agora = Date.now();
  const guardado = cache.get(orgId);
  if (guardado && agora - guardado.em < TTL_MS) return guardado.cred;

  const [linha] = await sql<LinhaCanal[]>`
    SELECT id, provedor, phone_number_id, base_url, instancia, token_cif
      FROM canal_whatsapp
     WHERE org_id = ${orgId}
       AND status = 'conectado'
     ORDER BY principal DESC, criado_em
     LIMIT 1
  `;

  let cred: Credenciais | null = null;

  if (linha?.token_cif) {
    cred = {
      provedor: linha.provedor,
      canalId: linha.id,
      // AAD amarra o token à organização: token copiado de outra linha não
      // decifra. Ver comentário em seguranca/cripto.ts.
      token: decifrar(linha.token_cif, `canal:${orgId}`),
      phoneNumberId: linha.phone_number_id,
      baseUrl: linha.base_url,
      instancia: linha.instancia,
    };
  }

  cache.set(orgId, { em: agora, cred });
  return cred;
}

/** Chamado quando o canal muda (conectar, desconectar, rotacionar token). */
export function esquecerCanal(orgId: string): void {
  cache.delete(orgId);
}

async function templateDaOrg(
  orgId: string,
  templateId: string,
): Promise<LinhaTemplate | null> {
  const [linha] = await sql<LinhaTemplate[]>`
    SELECT nome, idioma, corpo, variaveis_map, status
      FROM template_whatsapp
     WHERE id = ${templateId}
       AND org_id = ${orgId}
     LIMIT 1
  `;
  return linha ?? null;
}

/**
 * O canal de produção. Uma instância só serve todas as organizações.
 */
export function canalReal(): CanalWhatsApp {
  return {
    async enviarTexto(envio: EnvioTexto): Promise<ResultadoEnvio> {
      const cred = await credenciaisDaOrg(envio.orgId);
      if (!cred) return semCanal("nenhum canal de WhatsApp conectado");

      return PROVEDORES[cred.provedor].enviarTexto(cred, {
        para: envio.para,
        texto: envio.texto,
      });
    },

    async enviarTemplate(envio: EnvioTemplate): Promise<ResultadoEnvio> {
      const cred = await credenciaisDaOrg(envio.orgId);
      if (!cred) return semCanal("nenhum canal de WhatsApp conectado");

      const tpl = await templateDaOrg(envio.orgId, envio.templateId);
      if (!tpl) return semCanal("template não encontrado nesta organização");

      if (tpl.status !== "aprovado") {
        return {
          ok: false,
          erro: `template "${tpl.nome}" está ${tpl.status}, não aprovado`,
          retentar: false,
          codigo: "template",
        };
      }

      // Prévia: o corpo com os parâmetros no lugar. É o que fica guardado em
      // `mensagem.texto` — sem isso o histórico do cliente mostraria
      // "{{1}} {{2}}" e ninguém entenderia o que foi enviado.
      const previa = previaDoCorpo(tpl.corpo, envio.parametros);

      return PROVEDORES[cred.provedor].enviarTemplate(cred, {
        para: envio.para,
        nome: tpl.nome,
        idioma: tpl.idioma,
        parametros: envio.parametros,
        previa,
      });
    },
  };
}

/** Substitui {{1}}, {{2}}… pelos parâmetros posicionais da Meta. */
export function previaDoCorpo(corpo: string, parametros: string[]): string {
  return corpo.replace(/\{\{\s*(\d+)\s*\}\}/g, (achado, n: string) => {
    const valor = parametros[Number(n) - 1];
    return valor ?? achado;
  });
}

/**
 * Registra/atualiza o canal de uma organização com o token cifrado.
 *
 * Fica aqui, e não na DAL, porque cifrar e invalidar o cache são a mesma
 * decisão: quem grava token precisa fazer as duas coisas ou o worker segue
 * mandando com a credencial velha.
 */
export async function salvarCanal(
  tx: Transacao,
  entrada: {
    orgId: string;
    provedor: ProvedorCanal;
    nome: string;
    numeroE164: string;
    wabaId?: string | null;
    phoneNumberId?: string | null;
    baseUrl?: string | null;
    instancia?: string | null;
    token: string;
    /** Embedded Signup: PIN de 2 etapas usado no `/register` da Cloud API. */
    pin?: string | null;
  },
): Promise<{ canalId: string; webhookToken: string | null }> {
  const cifrado = cifrar(entrada.token, `canal:${entrada.orgId}`);
  const pinCifrado = entrada.pin ? cifrar(entrada.pin, `canal-pin:${entrada.orgId}`) : null;

  /**
   * Provedor não-oficial não assina o webhook: a autenticação dele é o segredo
   * da URL. Geramos um por save (reconectar invalida a URL antiga, que é o que
   * se quer quando alguém reconecta porque suspeita de vazamento) e devolvemos
   * em claro UMA vez — no banco fica só o hash.
   */
  const webhook =
    entrada.provedor === "evolution" ? gerarToken() : null;

  // Rebaixa o principal atual ANTES de inserir: o índice parcial
  // `ux_canal_principal` é verificado a cada statement, então inserir primeiro
  // e rebaixar depois estouraria a constraint.
  await tx`
    UPDATE canal_whatsapp
       SET principal = false, atualizado_em = now()
     WHERE org_id = ${entrada.orgId}
       AND principal
       AND numero_e164 <> ${entrada.numeroE164}
  `;

  const [linha] = await tx<{ id: string }[]>`
    INSERT INTO canal_whatsapp
      (org_id, provedor, nome, numero_e164, waba_id, phone_number_id,
       base_url, instancia, token_cif, pin_cif, chave_versao, webhook_token_hash,
       status, principal, verificado_em)
    VALUES
      (${entrada.orgId}, ${entrada.provedor}, ${entrada.nome},
       ${entrada.numeroE164}, ${entrada.wabaId ?? null},
       ${entrada.phoneNumberId ?? null}, ${entrada.baseUrl ?? null},
       ${entrada.instancia ?? null}, ${cifrado}, ${pinCifrado}, ${versaoAtual()},
       ${webhook?.hash ?? null}, 'conectado', true, now())
    ON CONFLICT (org_id, numero_e164) DO UPDATE
       SET token_cif       = EXCLUDED.token_cif,
           pin_cif         = COALESCE(EXCLUDED.pin_cif, canal_whatsapp.pin_cif),
           chave_versao    = EXCLUDED.chave_versao,
           provedor        = EXCLUDED.provedor,
           phone_number_id = EXCLUDED.phone_number_id,
           webhook_token_hash = EXCLUDED.webhook_token_hash,
           base_url        = EXCLUDED.base_url,
           instancia       = EXCLUDED.instancia,
           waba_id         = EXCLUDED.waba_id,
           status          = 'conectado',
           ultimo_erro     = NULL,
           verificado_em   = now(),
           atualizado_em   = now()
    RETURNING id
  `;

  esquecerCanal(entrada.orgId);
  return { canalId: linha.id, webhookToken: webhook?.token ?? null };
}

/** URL que a instância da Evolution deve chamar. Só faz sentido com o token em claro. */
export function urlWebhookEvolution(canalId: string, token: string): string {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return `${base}/api/webhooks/evolution/${canalId}?t=${encodeURIComponent(token)}`;
}

/**
 * Testa credenciais que ainda não estão no banco.
 *
 * Existe para o fluxo de conectar: token errado tem que falhar na tela, com o
 * motivo, e não virar um canal 'conectado' que só se descobre quebrado quando
 * a primeira cobrança não sai.
 */
export async function verificarCredenciais(
  entrada: {
    provedor: ProvedorCanal;
    token: string;
    phoneNumberId?: string | null;
    baseUrl?: string | null;
    instancia?: string | null;
  },
): Promise<ResultadoVerificacao> {
  return PROVEDORES[entrada.provedor].verificar({
    provedor: entrada.provedor,
    canalId: "",
    token: entrada.token,
    phoneNumberId: entrada.phoneNumberId ?? null,
    baseUrl: entrada.baseUrl ?? null,
    instancia: entrada.instancia ?? null,
  });
}

/**
 * Pergunta ao provedor se o canal ainda está de pé e grava o veredito.
 *
 * Roda no "Testar conexão" da tela e depois de conectar. Sempre lê do banco,
 * nunca do cache de 30s: quem clicou em testar quer o estado de agora, não o
 * que o worker viu meio minuto atrás.
 *
 * O status vira 'erro' quando falha, então o disparo do worker também para —
 * é melhor a régua travar com o motivo na tela do que ir marcando mensagem
 * como falha uma a uma até estourar a tentativa.
 */
export async function verificarCanal(
  orgId: string,
  canalId: string,
): Promise<ResultadoVerificacao> {
  const [linha] = await sql<LinhaCanal[]>`
    SELECT id, provedor, phone_number_id, base_url, instancia, token_cif
      FROM canal_whatsapp
     WHERE id = ${canalId} AND org_id = ${orgId}
     LIMIT 1
  `;

  if (!linha?.token_cif) {
    return { ok: false, erro: "canal não encontrado nesta organização", codigo: "canal" };
  }

  const resultado = await PROVEDORES[linha.provedor].verificar({
    provedor: linha.provedor,
    canalId: linha.id,
    token: decifrar(linha.token_cif, `canal:${orgId}`),
    phoneNumberId: linha.phone_number_id,
    baseUrl: linha.base_url,
    instancia: linha.instancia,
  });

  if (resultado.ok) {
    await sql`
      UPDATE canal_whatsapp
         SET status = 'conectado', ultimo_erro = NULL,
             qualidade = ${resultado.qualidade ?? null},
             verificado_em = now(), atualizado_em = now()
       WHERE id = ${canalId} AND org_id = ${orgId}
    `;
  } else {
    await sql`
      UPDATE canal_whatsapp
         SET status = 'erro', ultimo_erro = ${resultado.erro.slice(0, 500)},
             verificado_em = now(), atualizado_em = now()
       WHERE id = ${canalId} AND org_id = ${orgId}
    `;
  }

  esquecerCanal(orgId);
  return resultado;
}

/** O canal parou de funcionar: marca para a tela de canais e limpa o cache. */
export async function marcarCanalComErro(
  orgId: string,
  canalId: string,
  erro: string,
): Promise<void> {
  await sql`
    UPDATE canal_whatsapp
       SET ultimo_erro = ${erro.slice(0, 500)}, atualizado_em = now()
     WHERE id = ${canalId} AND org_id = ${orgId}
  `;
  esquecerCanal(orgId);
}
