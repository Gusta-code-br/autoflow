"use server";

import { refresh } from "next/cache";

import type { EstadoForm } from "@/lib/form";
import {
  criarAgendamento,
  criarBloqueio,
  EntradaAgendamento,
  EntradaServico,
  mudarStatusAgendamento,
  removerBloqueio,
  salvarServico,
  type AgendamentoDTO,
} from "@/server/dal/agenda";
import { exigirContexto } from "@/server/dal/contexto";
import { comOrg } from "@/server/db";
import { parseValorBR, reaisParaCentavos } from "@/server/dominio/dinheiro";
import { instanteDaHoraLocal } from "@/server/dominio/tempo";
import { marcado, opcional, paraEstado, texto } from "./comum";

/**
 * Agenda: marcar, mudar status, serviços e bloqueios.
 *
 * Nenhuma action aqui recebe `orgId` — a DAL resolve pelo cookie. E nenhuma
 * decide horário: converter "14:30 do dia 09" em instante depende do fuso da
 * organização, que mora no banco, então a conversão fica junto da escrita.
 */

const STATUS_VALIDOS: AgendamentoDTO["status"][] = [
  "pendente",
  "confirmado",
  "concluido",
  "cancelado",
  "faltou",
];

const MENSAGEM_STATUS: Record<AgendamentoDTO["status"], string> = {
  pendente: "Reaberto.",
  confirmado: "Confirmado.",
  concluido: "Marcado como concluído.",
  cancelado: "Cancelado.",
  faltou: "Marcado como falta.",
};

export async function criarAgendamentoAction(
  _anterior: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const valores = {
    contatoNome: texto(form, "contatoNome"),
    contatoTelefone: texto(form, "contatoTelefone"),
    servicoId: texto(form, "servicoId"),
    data: texto(form, "data"),
    hora: texto(form, "hora"),
    duracaoMin: texto(form, "duracaoMin") || "60",
    observacao: texto(form, "observacao"),
  };

  try {
    const entrada = EntradaAgendamento.parse(valores);
    await criarAgendamento(entrada);
    refresh();
    return { ok: true, mensagem: "Agendamento criado." };
  } catch (e) {
    return paraEstado(e, valores);
  }
}

export async function mudarStatusAction(
  _anterior: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  try {
    const status = texto(form, "status") as AgendamentoDTO["status"];
    if (!STATUS_VALIDOS.includes(status)) {
      return { ok: false, erro: "Status inválido." };
    }
    await mudarStatusAgendamento(texto(form, "id"), status);
    refresh();
    return { ok: true, mensagem: MENSAGEM_STATUS[status] };
  } catch (e) {
    return paraEstado(e);
  }
}

export async function salvarServicoAction(
  _anterior: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const valores = {
    id: texto(form, "id"),
    nome: texto(form, "nome"),
    duracaoMin: texto(form, "duracaoMin"),
    intervaloMin: texto(form, "intervaloMin") || "0",
    preco: texto(form, "preco"),
  };

  try {
    // O preço chega como "150,00" ou "R$ 150" — o banco guarda centavos.
    const reais = valores.preco ? parseValorBR(valores.preco) : null;
    if (valores.preco && reais === null) {
      return {
        ok: false,
        erro: "Confira os campos destacados.",
        campos: { preco: "Valor inválido." },
        valores,
      };
    }

    const entrada = EntradaServico.parse({
      id: valores.id,
      nome: valores.nome,
      duracaoMin: valores.duracaoMin,
      intervaloMin: valores.intervaloMin,
      precoCentavos: reais === null ? null : reaisParaCentavos(reais),
      ativo: form.has("ativo") ? marcado(form, "ativo") : true,
    });

    await salvarServico(entrada);
    refresh();
    return { ok: true, mensagem: "Serviço salvo." };
  } catch (e) {
    return paraEstado(e, valores);
  }
}

export async function criarBloqueioAction(
  _anterior: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const valores = {
    data: texto(form, "data"),
    horaInicio: texto(form, "horaInicio"),
    horaFim: texto(form, "horaFim"),
    motivo: texto(form, "motivo"),
  };

  try {
    const ctx = await exigirContexto();
    const [org] = await comOrg(ctx.orgId, (tx) =>
      tx<{ fuso: string }[]>`SELECT fuso FROM organizacao WHERE id = ${ctx.orgId}`,
    );

    const inicio = instanteDaHoraLocal(valores.data, valores.horaInicio, org.fuso);
    const fim = instanteDaHoraLocal(valores.data, valores.horaFim, org.fuso);

    await criarBloqueio(inicio, fim, opcional(form, "motivo"));
    refresh();
    return { ok: true, mensagem: "Horário bloqueado." };
  } catch (e) {
    return paraEstado(e, valores);
  }
}

export async function removerBloqueioAction(
  _anterior: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  try {
    await removerBloqueio(texto(form, "id"));
    refresh();
    return { ok: true, mensagem: "Bloqueio removido." };
  } catch (e) {
    return paraEstado(e);
  }
}
