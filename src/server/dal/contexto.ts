import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { timingSafeEqual } from "node:crypto";

import { sql } from "@/server/db";
import { gerarToken, hashToken } from "@/server/seguranca/cripto";

/**
 * Sessão e contexto da organização.
 *
 * Toda função que lê dados chama `exigirContexto()` — a verificação fica perto
 * do dado, não no middleware. Middleware é otimização de redirect; se a
 * autorização morar só lá, qualquer rota nova esquecida no matcher fica aberta.
 * (É literalmente o que o guia de Data Security do Next recomenda: Data Access
 * Layer com a checagem junto da query.)
 */

const COOKIE_SESSAO = "autoflow_sessao";
const COOKIE_ORG = "autoflow_org";
const DURACAO_SESSAO_DIAS = 30;
/** Renova o cookie quando faltar menos que isto — evita UPDATE a cada request. */
const RENOVAR_QUANDO_FALTAR_DIAS = 7;

export type Papel = "dono" | "admin" | "atendente";

export interface Contexto {
  usuarioId: string;
  nome: string;
  email: string;
  orgId: string;
  orgNome: string;
  papel: Papel;
  fuso: string;
  onboardingCompleto: boolean;
  /** Quantas organizações este usuário acessa — habilita o seletor na UI. */
  totalOrgs: number;
}

/**
 * `cache()` deduplica por requisição: várias partes da página pedem o contexto,
 * mas a consulta roda uma vez só. Não é cache entre requisições — sessão nunca
 * pode ser compartilhada entre usuários.
 */
export const getContexto = cache(async (): Promise<Contexto | null> => {
  const jar = await cookies();
  const token = jar.get(COOKIE_SESSAO)?.value;
  if (!token) return null;

  const hash = hashToken(token);
  const orgPreferida = jar.get(COOKIE_ORG)?.value ?? null;

  // Sessão e vínculo em uma consulta só. Não há RLS aqui porque ainda não
  // sabemos a org — é justamente esta query que a descobre. Por isso o filtro é
  // explícito e ancorado no hash do token, que é único.
  const linhas = await sql<
    {
      usuario_id: string;
      nome: string;
      email: string;
      org_id: string;
      org_nome: string;
      papel: Papel;
      fuso: string;
      onboarding_completo: boolean;
      token_hash: string;
      expira_em: Date;
      total_orgs: string;
    }[]
  >`
    SELECT u.id                AS usuario_id,
           u.nome,
           u.email::text       AS email,
           o.id                AS org_id,
           o.nome_empresa      AS org_nome,
           m.papel,
           o.fuso,
           o.onboarding_completo,
           s.token_hash,
           s.expira_em,
           count(*) OVER ()    AS total_orgs
      FROM sessao s
      JOIN usuario u     ON u.id = s.usuario_id
      JOIN membro  m     ON m.usuario_id = u.id
      JOIN organizacao o ON o.id = m.org_id
     WHERE s.token_hash = ${hash}
       AND s.expira_em > now()
     -- Um usuário pode ser dono da própria clínica e atendente na de um sócio.
     -- Sem ORDER BY determinístico, ele "trocaria de empresa" sozinho entre
     -- requisições, dependendo do plano de execução do Postgres.
     ORDER BY (o.id::text = ${orgPreferida}) DESC, m.criado_em ASC
     LIMIT 1
  `;

  const l = linhas[0];
  if (!l) return null;

  // Comparação em tempo constante mesmo já tendo filtrado no banco: custa nada
  // e fecha a porta para qualquer diferença de tempo no caminho até aqui.
  const a = Buffer.from(l.token_hash, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  return {
    usuarioId: l.usuario_id,
    nome: l.nome,
    email: l.email,
    orgId: l.org_id,
    orgNome: l.org_nome,
    papel: l.papel,
    fuso: l.fuso,
    onboardingCompleto: l.onboarding_completo,
    totalOrgs: Number(l.total_orgs),
  };
});

export class NaoAutenticadoError extends Error {
  constructor() {
    super("sessão inválida ou expirada");
    this.name = "NaoAutenticadoError";
  }
}

export class SemPermissaoError extends Error {
  constructor(acao: string) {
    super(`sem permissão para: ${acao}`);
    this.name = "SemPermissaoError";
  }
}

export async function exigirContexto(): Promise<Contexto> {
  const ctx = await getContexto();
  if (!ctx) throw new NaoAutenticadoError();
  return ctx;
}

const HIERARQUIA: Record<Papel, number> = { atendente: 1, admin: 2, dono: 3 };

export async function exigirPapel(
  minimo: Papel,
  acao: string,
): Promise<Contexto> {
  const ctx = await exigirContexto();
  if (HIERARQUIA[ctx.papel] < HIERARQUIA[minimo]) {
    throw new SemPermissaoError(acao);
  }
  return ctx;
}

/**
 * Nem toda leitura pode ser vista por todo mundo. O atendente vê a conversa e a
 * cobrança do cliente que ele atende, mas não vê faturamento, plano nem
 * telefone completo — daí este helper, usado pela DAL na hora de montar o DTO.
 */
export function podeVerFinanceiro(papel: Papel): boolean {
  return papel !== "atendente";
}

export async function criarSessao(
  usuarioId: string,
  dados: { ip?: string | null; userAgent?: string | null } = {},
): Promise<void> {
  const { token, hash } = gerarToken();
  const expira = new Date(Date.now() + DURACAO_SESSAO_DIAS * 86_400_000);

  await sql`
    INSERT INTO sessao (usuario_id, token_hash, ip, user_agent, expira_em)
    VALUES (
      ${usuarioId},
      ${hash},
      ${dados.ip && dados.ip !== "desconhecido" ? dados.ip : null}::inet,
      ${dados.userAgent?.slice(0, 400) ?? null},
      ${expira}
    )
  `;

  await sql`UPDATE usuario SET ultimo_acesso_em = now() WHERE id = ${usuarioId}`;

  const jar = await cookies();
  jar.set(COOKIE_SESSAO, token, {
    httpOnly: true, // fora do alcance de qualquer script — mitiga XSS virar roubo de conta
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax", // "strict" quebraria o retorno do checkout do Mercado Pago
    path: "/",
    expires: expira,
  });
}

/**
 * Estende a validade da sessão de quem usa o sistema todo dia, sem obrigar
 * login a cada 30 dias. Só grava quando está perto de vencer.
 */
export async function renovarSessaoSePreciso(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE_SESSAO)?.value;
  if (!token) return;

  const novoExpira = new Date(Date.now() + DURACAO_SESSAO_DIAS * 86_400_000);
  const limite = new Date(
    Date.now() + RENOVAR_QUANDO_FALTAR_DIAS * 86_400_000,
  );

  const linhas = await sql`
    UPDATE sessao
       SET expira_em = ${novoExpira}
     WHERE token_hash = ${hashToken(token)}
       AND expira_em > now()
       AND expira_em < ${limite}
    RETURNING id
  `;

  if (linhas.length > 0) {
    jar.set(COOKIE_SESSAO, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: novoExpira,
    });
  }
}

export async function trocarOrganizacao(orgId: string): Promise<void> {
  const ctx = await exigirContexto();

  // Confere o vínculo ANTES de gravar o cookie. O cookie é só uma preferência;
  // se ele apontasse para uma org sem vínculo, a query do getContexto ignoraria
  // — mas é melhor falhar aqui, alto e claro, do que confundir o usuário.
  const [vinculo] = await sql`
    SELECT 1 FROM membro WHERE org_id = ${orgId} AND usuario_id = ${ctx.usuarioId}
  `;
  if (!vinculo) throw new SemPermissaoError("acessar esta organização");

  const jar = await cookies();
  jar.set(COOKIE_ORG, orgId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 400 * 86_400,
  });
}

export async function encerrarSessao(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE_SESSAO)?.value;
  if (token) {
    // Apaga do banco, não só o cookie: logout tem que invalidar o token de
    // verdade, senão quem copiou o cookie continua dentro.
    await sql`DELETE FROM sessao WHERE token_hash = ${hashToken(token)}`;
  }
  jar.delete(COOKIE_SESSAO);
  jar.delete(COOKIE_ORG);
}

/** Usado ao trocar de senha: derruba todos os aparelhos. */
export async function encerrarTodasSessoes(usuarioId: string): Promise<void> {
  await sql`DELETE FROM sessao WHERE usuario_id = ${usuarioId}`;
}
