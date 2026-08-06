"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import type { EstadoForm } from "@/lib/form";
import {
  EntradaConfig,
  EntradaOnboarding,
  salvarConfig,
  salvarOnboarding,
} from "@/server/dal/organizacao";
import {
  listaDeNumeros,
  lista,
  marcado,
  opcional,
  paraEstado,
  texto,
} from "./comum";

/**
 * Onboarding e configurações da organização.
 *
 * As 4 perguntas do onboarding não são burocracia: elas viram o prompt do
 * atendente, o horário em que o robô pode falar e a chave PIX que entra na
 * mensagem de cobrança. Por isso a validação é a mesma da DAL (o schema zod é
 * importado, não recriado) — divergir aqui seria gravar dado que o resto do
 * sistema não sabe usar.
 */

export async function salvarOnboardingAction(
  _anterior: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const bruto = {
    segmento: opcional(form, "segmento"),
    nomeAtendente: texto(form, "nomeAtendente"),
    tom: texto(form, "tom") || "amigavel",
    objetivos: lista(form, "objetivos"),
    instrucoesExtra: opcional(form, "instrucoesExtra"),
    horarioInicio: texto(form, "horarioInicio") || "09:00",
    horarioFim: texto(form, "horarioFim") || "18:00",
    // Sem dia marcado o robô nunca dispararia e o cliente acharia que o
    // produto está quebrado. Seg–sex é o padrão de quem vende serviço.
    diasSemana: comPadrao(listaDeNumeros(form, "diasSemana"), [1, 2, 3, 4, 5]),
    fuso: texto(form, "fuso") || "America/Sao_Paulo",
    whatsappPessoal: opcional(form, "whatsappPessoal"),
    chavePix: opcional(form, "chavePix"),
  };

  try {
    await salvarOnboarding(EntradaOnboarding.parse(bruto));
  } catch (e) {
    return paraEstado(e, textoDosCampos(bruto));
  }

  // Onboarding é a última tela antes do produto: manda para o painel já.
  // O `?bemvindo=1` vira um toast de boas-vindas (ver <FlashToast>) — sem ele
  // o cliente termina 4 perguntas e a tela seguinte não confirma nada.
  redirect("/painel?bemvindo=1");
}

/**
 * Atualização parcial vinda da tela de configurações.
 *
 * Diferente do onboarding, aqui cada aba do formulário manda só os seus campos
 * — daí `EntradaConfig` ser tudo opcional e este código só incluir chave que
 * realmente veio no FormData. Mandar `undefined` para o resto faria a DAL
 * apagar configuração que o usuário nem estava editando.
 */
export async function salvarConfigAction(
  _anterior: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const bruto: Record<string, unknown> = {};

  for (const campo of [
    "nomeEmpresa",
    "segmento",
    "nomeAtendente",
    "tom",
    "instrucoesExtra",
    "horarioInicio",
    "horarioFim",
    "fuso",
    "whatsappPessoal",
    "chavePix",
  ] as const) {
    if (form.has(campo)) bruto[campo] = texto(form, campo);
  }

  if (form.has("objetivos")) bruto.objetivos = lista(form, "objetivos");
  if (form.has("diasSemana")) bruto.diasSemana = listaDeNumeros(form, "diasSemana");

  // Checkbox desmarcado não aparece no FormData — por isso o campo espelho
  // `<input type="hidden" name="notificar">` marca quais vieram na tela. Sem
  // isso, desmarcar uma notificação seria indistinguível de não mandá-la.
  for (const flag of lista(form, "notificacoes")) {
    if (
      flag === "notificarNovoAgendamento" ||
      flag === "notificarPagamento" ||
      flag === "notificarSemResposta"
    ) {
      bruto[flag] = marcado(form, flag);
    }
  }

  try {
    await salvarConfig(EntradaConfig.parse(bruto));
  } catch (e) {
    return paraEstado(e);
  }

  // Os dados do painel não são cacheados (dependem do cookie de sessão), então
  // `refresh` é o certo aqui: reexecuta os Server Components desta navegação
  // sem invalidar cache nenhum — `revalidatePath` não teria o que invalidar.
  refresh();
  return { ok: true, mensagem: "Configurações salvas." };
}

// ---------------------------------------------------------------------------

function comPadrao<T>(valores: T[], padrao: T[]): T[] {
  return valores.length > 0 ? valores : padrao;
}

/** Só o que dá para repovoar em um input de texto volta para a tela. */
function textoDosCampos(bruto: Record<string, unknown>): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(bruto)) {
    if (typeof valor === "string") saida[chave] = valor;
  }
  return saida;
}
