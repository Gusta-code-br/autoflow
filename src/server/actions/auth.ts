"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import type { EstadoForm } from "@/lib/form";
import {
  criarSessao,
  encerrarSessao,
  encerrarTodasSessoes,
  exigirContexto,
  getContexto,
  trocarOrganizacao,
} from "@/server/dal/contexto";
import {
  autenticar,
  EntradaRegistro,
  registrar,
  trocarSenha,
} from "@/server/dal/organizacao";
import { consumir, ipDaRequisicao, liberar } from "@/server/seguranca/limite";
import { opcional, paraEstado, texto } from "./comum";

/**
 * Entrada e saída do sistema.
 *
 * Toda ação aqui é um endpoint POST público — o guia do Next é explícito:
 * Server Actions são alcançáveis por POST direto, não só pela UI. Por isso
 * cada uma revalida entrada, limite de taxa e permissão por conta própria, sem
 * confiar em nada que o formulário tenha mandado junto (papel, orgId, etc.).
 */

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export async function entrarAction(
  _anterior: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const email = texto(form, "email").toLowerCase();
  const senha = String(form.get("senha") ?? "");
  const destino = destinoSeguro(texto(form, "destino"));
  const valores = { email };

  if (!email || !senha) {
    return { ok: false, erro: "Preencha e-mail e senha.", valores };
  }

  const cabecalhos = await headers();
  const ip = ipDaRequisicao(cabecalhos);

  // Dois limites, propósitos diferentes: o do e-mail protege *uma* conta de
  // força bruta; o do IP impede varrer muitas contas com uma senha comum
  // ("123456" em 10 mil e-mails passaria folgado no limite por conta).
  const porConta = await consumir("login", `conta:${email}`);
  const porIp = await consumir("login", `ip:${ip}`);
  if (!porConta.permitido || !porIp.permitido) {
    const esperar = Math.max(porConta.esperarSeg, porIp.esperarSeg);
    return {
      ok: false,
      erro: `Muitas tentativas. Tente de novo em ${Math.ceil(esperar / 60)} minutos.`,
      valores,
    };
  }

  let usuarioId: string;
  try {
    const usuario = await autenticar(email, senha);
    if (!usuario) {
      // Mensagem idêntica para e-mail inexistente e senha errada: a diferença
      // transformaria a tela em um verificador de "fulano é cliente daqui?".
      return { ok: false, erro: "E-mail ou senha incorretos.", valores };
    }
    usuarioId = usuario.usuarioId;

    await criarSessao(usuarioId, {
      ip,
      userAgent: cabecalhos.get("user-agent"),
    });
  } catch (e) {
    return paraEstado(e, valores);
  }

  // Login certo devolve as tentativas: quem errou a senha duas vezes e acertou
  // na terceira não pode ficar com o contador quase estourado até a janela cair.
  await liberar("login", `conta:${email}`);

  // `redirect` funciona lançando uma exceção especial — precisa ficar fora do
  // try, senão o catch acima a engoliria e o usuário logaria sem sair da tela.
  redirect(destino);
}

// ---------------------------------------------------------------------------
// Cadastro
// ---------------------------------------------------------------------------

export async function cadastrarAction(
  _anterior: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const entrada = {
    nome: texto(form, "nome"),
    email: texto(form, "email").toLowerCase(),
    senha: String(form.get("senha") ?? ""),
    nomeEmpresa: texto(form, "nomeEmpresa"),
    telefone: opcional(form, "telefone"),
  };
  const valores = {
    nome: entrada.nome,
    email: entrada.email,
    nomeEmpresa: entrada.nomeEmpresa,
    telefone: entrada.telefone ?? "",
  };

  const cabecalhos = await headers();
  const ip = ipDaRequisicao(cabecalhos);

  const limite = await consumir("registro", `ip:${ip}`);
  if (!limite.permitido) {
    return {
      ok: false,
      erro: "Muitas contas criadas deste acesso. Tente mais tarde.",
      valores,
    };
  }

  try {
    const dados = EntradaRegistro.parse(entrada);
    const { usuarioId } = await registrar(dados);
    await criarSessao(usuarioId, { ip, userAgent: cabecalhos.get("user-agent") });
  } catch (e) {
    return paraEstado(e, valores);
  }

  // Cadastro cai direto no onboarding: as 4 perguntas são o que transforma a
  // conta vazia em robô funcionando. Painel antes disso é tela vazia.
  redirect("/onboarding");
}

// ---------------------------------------------------------------------------
// Sessão
// ---------------------------------------------------------------------------

export async function sairAction(): Promise<void> {
  await encerrarSessao();
  redirect("/entrar");
}

/** Desconecta todos os aparelhos — útil quando a pessoa desconfia de acesso. */
export async function sairDeTudoAction(): Promise<void> {
  const ctx = await getContexto();
  if (ctx) await encerrarTodasSessoes(ctx.usuarioId);
  redirect("/entrar");
}

export async function trocarOrganizacaoAction(form: FormData): Promise<void> {
  const orgId = texto(form, "orgId");
  // `trocarOrganizacao` confere na DAL se o usuário é membro desta org antes de
  // gravar o cookie. Aqui não dá para checar: o valor veio do cliente.
  if (orgId) await trocarOrganizacao(orgId);
  redirect("/painel");
}

export async function trocarSenhaAction(
  _anterior: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const atual = String(form.get("senhaAtual") ?? "");
  const nova = String(form.get("senhaNova") ?? "");
  const confirmacao = String(form.get("senhaConfirmacao") ?? "");

  if (nova !== confirmacao) {
    return { ok: false, erro: "A confirmação não bate com a nova senha." };
  }

  try {
    const ctx = await exigirContexto();
    await trocarSenha(ctx.usuarioId, atual, nova);
    // A sessão atual continua valendo; as outras caem. Trocar senha por
    // desconfiança de invasão só resolve se expulsar quem já estava dentro.
    await encerrarTodasSessoes(ctx.usuarioId);
    await criarSessao(ctx.usuarioId);
  } catch (e) {
    return paraEstado(e);
  }

  return { ok: true, mensagem: "Senha alterada. Os outros aparelhos foram desconectados." };
}

// ---------------------------------------------------------------------------

/**
 * Só aceita caminho interno.
 *
 * O `?destino=` da tela de login volta para a página que exigiu autenticação.
 * Sem esta trava, `?destino=https://site-falso/` faria o AutoFlow redirecionar
 * para fora logo depois do login — phishing com a nossa credibilidade emprestada.
 * `//outro.com` também é URL absoluta para o navegador, daí a segunda checagem.
 */
function destinoSeguro(valor: string): string {
  if (!valor.startsWith("/") || valor.startsWith("//")) return "/painel";
  return valor;
}
