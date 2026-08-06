"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import type { EstadoForm } from "@/lib/form";
import {
  cancelarCobranca,
  criarCobranca,
  EntradaNovaCobranca,
  marcarComoPago,
} from "@/server/dal/cobrancas";
import { CENTAVOS_MAX, parseValorBR, reaisParaCentavos } from "@/server/dominio/dinheiro";
import { dataLocalDe, diasEntre, horaLocalDe } from "@/server/dominio/tempo";
import { consumir } from "@/server/seguranca/limite";
import { exigirContexto } from "@/server/dal/contexto";
import { opcional, paraEstado, texto } from "./comum";

/**
 * Cobranças: criar, dar baixa.
 *
 * A regra de ouro deste arquivo é que nada aqui decide de quem é a cobrança —
 * a DAL resolve org e papel a partir do cookie de sessão. Um `orgId` que
 * chegasse pelo formulário seria ignorado de propósito.
 */

export async function criarCobrancaAction(
  _anterior: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const valores = {
    nome: texto(form, "nome"),
    telefone: texto(form, "telefone"),
    email: texto(form, "email"),
    descricao: texto(form, "descricao"),
    valor: texto(form, "valor"),
    vencimento: texto(form, "vencimento"),
    observacao: texto(form, "observacao"),
  };

  // O campo de valor é digitado à mão: "1.234,56", "R$ 90", "90.00" — tudo
  // chega aqui. Converter para centavos inteiros antes de qualquer coisa evita
  // float no dinheiro, que é como se perde um centavo por cobrança.
  const reais = parseValorBR(valores.valor);
  if (reais === null) {
    return {
      ok: false,
      erro: "Confira os campos destacados.",
      campos: { valor: "Informe um valor, ex.: 1.234,56" },
      valores,
    };
  }
  const centavos = reaisParaCentavos(reais);
  if (centavos > CENTAVOS_MAX) {
    return {
      ok: false,
      erro: "Confira os campos destacados.",
      campos: { valor: "Valor alto demais — confira se não sobrou um zero." },
      valores,
    };
  }

  try {
    const ctx = await exigirContexto();

    // Teto de sanidade por organização. Não é sobre custo (o crédito já cobra
    // isso), é sobre não deixar um script com bug disparar 5 mil mensagens em
    // nome do cliente e queimar o número dele no WhatsApp.
    const limite = await consumir("envioManual", `org:${ctx.orgId}`);
    if (!limite.permitido) {
      return {
        ok: false,
        erro: "Muitas cobranças criadas na última hora. Respire e tente de novo em breve.",
        valores,
      };
    }

    const entrada = EntradaNovaCobranca.parse({
      contato: {
        nome: valores.nome,
        telefone: valores.telefone,
        email: valores.email || undefined,
      },
      descricao: valores.descricao,
      valorCentavos: centavos,
      vencimento: valores.vencimento,
      reguaId: opcional(form, "reguaId") ?? null,
      observacao: valores.observacao || undefined,
    });

    const r = await criarCobranca(entrada);
    refresh();

    // A promessa da tela é "a régua já está rodando". Devolver quando sai a
    // primeira mensagem é o que prova isso para quem acabou de cadastrar.
    const quando = r.primeiroDisparoEm
      ? ` A primeira mensagem sai ${descreverQuando(r.primeiroDisparoEm, ctx.fuso)}.`
      : "";
    return {
      ok: true,
      mensagem: `Cobrança criada com ${r.disparosAgendados} ${
        r.disparosAgendados === 1 ? "mensagem agendada" : "mensagens agendadas"
      }.${quando}${r.avisos.length ? " " + r.avisos.join(" ") : ""}`,
    };
  } catch (e) {
    return achatarContato(paraEstado(e, valores));
  }
}

/**
 * O schema da DAL aninha o contato (`contato.telefone`), mas o formulário é
 * plano (`name="telefone"`). Sem esta tradução o erro chega com uma chave que
 * nenhum input reconhece e o campo errado não fica destacado — o usuário vê
 * "confira os campos" sem saber qual.
 */
function achatarContato(estado: EstadoForm): EstadoForm {
  if (!estado.campos) return estado;
  const campos: Record<string, string> = {};
  for (const [chave, msg] of Object.entries(estado.campos)) {
    campos[chave.startsWith("contato.") ? chave.slice("contato.".length) : chave] ??= msg;
  }
  return { ...estado, campos };
}

const IdCobranca = z.string().uuid("cobrança inválida");

export async function marcarPagoAction(
  _anterior: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  try {
    const id = IdCobranca.parse(texto(form, "cobrancaId"));

    // Baixa parcial é comum ("pagou R$ 50 dos R$ 200"); sem valor, a DAL
    // considera o total.
    const pago = parseValorBR(opcional(form, "valorPago"));
    await marcarComoPago(id, pago === null ? undefined : reaisParaCentavos(pago));
  } catch (e) {
    return paraEstado(e);
  }

  refresh();
  return { ok: true, mensagem: "Pagamento registrado. A régua parou para este cliente." };
}

export async function cancelarCobrancaAction(
  _anterior: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  try {
    const id = IdCobranca.parse(texto(form, "cobrancaId"));
    await cancelarCobranca(id, opcional(form, "motivo"));
  } catch (e) {
    return paraEstado(e);
  }

  refresh();
  return {
    ok: true,
    mensagem: "Cobrança cancelada. Nenhuma mensagem sai mais para este cliente.",
  };
}

// ---------------------------------------------------------------------------

/**
 * "hoje às 14:00", "amanhã às 09:00" — data ISO não diz nada a quem está na tela.
 *
 * Tudo calculado no fuso da organização, não no do servidor: às 22h de Brasília
 * o servidor em UTC já virou o dia e diria "amanhã" para algo que sai hoje.
 */
function descreverQuando(iso: string, fuso: string): string {
  const alvo = new Date(iso);
  const dias = diasEntre(dataLocalDe(new Date(), fuso), dataLocalDe(alvo, fuso));
  const hora = horaLocalDe(alvo, fuso);

  if (dias <= 0) return `hoje às ${hora}`;
  if (dias === 1) return `amanhã às ${hora}`;
  return `em ${dias} dias, às ${hora}`;
}
