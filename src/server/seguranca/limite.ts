import "server-only";

import { createHmac } from "node:crypto";

import { sql } from "@/server/db";

/**
 * Rate limit por janela fixa, persistido no Postgres.
 *
 * Por que no banco e não em memória: na Vercel cada requisição pode cair em uma
 * instância diferente, e instâncias somem entre requisições. Um Map em memória
 * daria a *impressão* de proteção enquanto um atacante simplesmente alternaria
 * entre instâncias. Redis seria mais barato por operação, mas é mais um serviço
 * para o dono da clínica pagar; o Postgres já está lá e um UPSERT por tentativa
 * de login é irrelevante perto do resto.
 */

export interface Limite {
  /** Quantas ações são permitidas na janela. */
  max: number;
  /** Tamanho da janela em segundos. */
  janelaSeg: number;
  /**
   * Quanto tempo bloquear depois de estourar. Sem isso, o atacante volta a ter
   * `max` tentativas a cada janela; com isso, estourar sai caro.
   */
  bloqueioSeg?: number;
}

export const LIMITES = {
  /** Login: protege contra força bruta em uma conta específica. */
  login: { max: 5, janelaSeg: 900, bloqueioSeg: 900 },
  /** Cadastro por IP: evita criação em massa de orgs de trial. */
  registro: { max: 5, janelaSeg: 3600, bloqueioSeg: 3600 },
  /** Recuperação de senha: evita usar o app como canhão de e-mail. */
  recuperacao: { max: 3, janelaSeg: 3600, bloqueioSeg: 3600 },
  /** Convites por organização. */
  convite: { max: 20, janelaSeg: 3600 },
  /** Disparo manual de mensagem — teto de sanidade por organização. */
  envioManual: { max: 300, janelaSeg: 3600 },
  /** Importação de contatos. */
  importacao: { max: 5, janelaSeg: 3600 },
} as const satisfies Record<string, Limite>;

export type NomeLimite = keyof typeof LIMITES;

export interface ResultadoLimite {
  permitido: boolean;
  restantes: number;
  /** Segundos até poder tentar de novo. Só faz sentido quando bloqueado. */
  esperarSeg: number;
}

/**
 * Consome uma unidade do limite.
 *
 * O identificador é hasheado antes de virar chave. Motivo: a chave natural do
 * limite de login é o e-mail, e não quero uma tabela operacional virando um
 * índice de e-mails de clientes — quem tiver acesso de leitura ao banco por
 * qualquer motivo (backup, suporte, replica) não precisa ver isso.
 */
export async function consumir(
  nome: NomeLimite,
  identificador: string,
): Promise<ResultadoLimite> {
  const cfg: Limite = LIMITES[nome];
  const chave = `${nome}:${digerir(identificador)}`;

  // Tudo em uma query só: ler, decidir e gravar em três roundtrips abriria uma
  // corrida onde dois logins simultâneos leem "4 tentativas" e ambos passam.
  // O ON CONFLICT ... DO UPDATE é atômico sob o lock da linha.
  const [linha] = await sql<
    { contagem: number; bloqueado_ate: Date | null }[]
  >`
    INSERT INTO limite_taxa (chave, contagem, janela_inicio, janela_seg)
    VALUES (${chave}, 1, now(), ${cfg.janelaSeg})
    ON CONFLICT (chave) DO UPDATE SET
      -- Janela expirada? Zera e recomeça. Senão, incrementa.
      contagem = CASE
        WHEN limite_taxa.janela_inicio < now() - make_interval(secs => limite_taxa.janela_seg)
          THEN 1
        ELSE limite_taxa.contagem + 1
      END,
      janela_inicio = CASE
        WHEN limite_taxa.janela_inicio < now() - make_interval(secs => limite_taxa.janela_seg)
          THEN now()
        ELSE limite_taxa.janela_inicio
      END,
      janela_seg = ${cfg.janelaSeg},
      bloqueado_ate = CASE
        -- Mantém o bloqueio vigente: tentar durante o castigo não o encurta.
        WHEN limite_taxa.bloqueado_ate > now() THEN limite_taxa.bloqueado_ate
        ELSE NULL
      END,
      atualizado_em = now()
    RETURNING contagem, bloqueado_ate
  `;

  const agora = Date.now();

  if (linha.bloqueado_ate && linha.bloqueado_ate.getTime() > agora) {
    return {
      permitido: false,
      restantes: 0,
      esperarSeg: Math.ceil((linha.bloqueado_ate.getTime() - agora) / 1000),
    };
  }

  if (linha.contagem > cfg.max) {
    if (cfg.bloqueioSeg) {
      await sql`
        UPDATE limite_taxa
           SET bloqueado_ate = now() + make_interval(secs => ${cfg.bloqueioSeg})
         WHERE chave = ${chave} AND (bloqueado_ate IS NULL OR bloqueado_ate < now())
      `;
    }
    return {
      permitido: false,
      restantes: 0,
      esperarSeg: cfg.bloqueioSeg ?? cfg.janelaSeg,
    };
  }

  return {
    permitido: true,
    restantes: cfg.max - linha.contagem,
    esperarSeg: 0,
  };
}

/**
 * Zera o contador. Chamado depois de um login bem-sucedido: quem acertou a
 * senha não deve ficar de castigo pelas tentativas erradas anteriores (a pessoa
 * que esqueceu a senha e tentou 4 variações é o caso comum, não o atacante).
 */
export async function liberar(
  nome: NomeLimite,
  identificador: string,
): Promise<void> {
  await sql`DELETE FROM limite_taxa WHERE chave = ${`${nome}:${digerir(identificador)}`}`;
}

/** Limpeza de linhas mortas — o worker chama de tempos em tempos. */
export async function limparAntigos(): Promise<number> {
  const linhas = await sql`
    DELETE FROM limite_taxa
     WHERE atualizado_em < now() - interval '7 days'
       AND (bloqueado_ate IS NULL OR bloqueado_ate < now())
    RETURNING chave
  `;
  return linhas.length;
}

function digerir(valor: string): string {
  const segredo = process.env.AUTH_SECRET ?? "";
  return createHmac("sha256", segredo)
    .update(valor.trim().toLowerCase())
    .digest("base64url")
    .slice(0, 32);
}

/**
 * Extrai o IP do cliente dos headers.
 *
 * Atenção: `x-forwarded-for` é livremente forjável quando a aplicação está
 * exposta direto. Só é confiável porque, atrás da Vercel/Cloudflare, o proxy
 * reescreve o header. Se um dia isso rodar em VPS nu, trocar por
 * `x-real-ip` do nosso próprio nginx — senão o rate limit por IP vira decorativo.
 */
export function ipDaRequisicao(headers: Headers): string {
  const encaminhado = headers.get("x-forwarded-for");
  if (encaminhado) {
    // O primeiro da lista é o cliente; o resto são os proxies do caminho.
    const primeiro = encaminhado.split(",")[0]?.trim();
    if (primeiro) return primeiro;
  }
  return headers.get("x-real-ip")?.trim() || "desconhecido";
}
