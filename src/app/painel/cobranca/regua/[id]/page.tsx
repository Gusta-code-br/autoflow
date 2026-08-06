import { notFound } from "next/navigation";

import { Bloqueado } from "@/components/shell";
import { buscarConfig } from "@/server/dal/organizacao";
import { carregarSessaoPainel } from "@/server/dal/painel";
import { listarCobrancas } from "@/server/dal/cobrancas";
import { buscarRegua } from "@/server/dal/reguas";
import { Editor, type CobrancaExemplo, type ReguaEditavel } from "./editor";

/**
 * Editor de régua.
 *
 * O desenho da régua é estado de rascunho: o usuário arrasta etapa, muda hora,
 * escreve mensagem e só então salva — nada disso vai ao servidor no meio do
 * caminho. Por isso a página é Server Component fina (carrega o desenho atual,
 * a configuração de horário e algumas cobranças reais) e o editor inteiro é
 * client, com um `<form>` só que serializa o desenho no submit.
 *
 * O simulador usa `materializarDisparos`, a MESMA função que o worker roda. Um
 * simulador com regra própria mente exatamente no dia em que alguém mexe na
 * janela de expediente.
 */

const NOVA: ReguaEditavel = {
  id: null,
  nome: "",
  descricao: "",
  ativa: true,
  aplicarA: "todas",
  tag: "",
  pausarAoResponder: true,
  pausarAoPagar: true,
  padrao: false,
  etapas: [
    {
      chave: "e1",
      id: null,
      referencia: "vencimento",
      offsetDias: -3,
      hora: "09:00",
      condicao: "se_nao_pago",
      acao: "enviar_whatsapp",
      mensagem:
        "Oi {{nome}}! Passando para lembrar: {{descricao}} de {{valor}} vence em {{vencimento}}. Qualquer coisa é só responder por aqui. 🙂",
      templateId: null,
      anexarPix: true,
      ativa: true,
    },
  ],
};

export default async function ReguaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const sessao = await carregarSessaoPainel();
  if (!sessao.plano.features.includes("cobranca")) {
    return <Bloqueado feature="cobranca" />;
  }

  const novo = id === "nova";
  const [dto, config, cobrancas] = await Promise.all([
    novo ? Promise.resolve(null) : buscarRegua(id),
    buscarConfig(),
    // O simulador precisa de cobranças de verdade: data de vencimento real, com
    // e sem pagamento. 12 é o bastante para o select e barato de carregar.
    listarCobrancas({ limite: 12 }),
  ]);

  if (!novo && !dto) notFound();

  const regua: ReguaEditavel = dto
    ? {
        id: dto.id,
        nome: dto.nome,
        descricao: dto.descricao ?? "",
        ativa: dto.ativa,
        aplicarA: dto.aplicarA,
        tag: dto.tag ?? "",
        pausarAoResponder: dto.pausarAoResponder,
        pausarAoPagar: dto.pausarAoPagar,
        padrao: dto.padrao,
        etapas: dto.etapas.map((e) => ({
          chave: e.id,
          id: e.id,
          referencia: e.referencia,
          offsetDias: e.offsetDias,
          hora: e.hora,
          condicao: e.condicao,
          acao: e.acao,
          mensagem: e.mensagem ?? "",
          templateId: e.templateId,
          anexarPix: e.anexarPix,
          ativa: e.ativa,
        })),
      }
    : NOVA;

  const exemplos: CobrancaExemplo[] = cobrancas.map((c) => ({
    id: c.id,
    cliente: c.contato.nome,
    descricao: c.descricao,
    valorCentavos: c.valorFormatadoCentavos,
    vencimento: c.vencimento,
    criadoEm: c.criadoEm,
    pagoEm: c.pagoEm,
    status: c.status,
  }));

  return (
    <Editor
      regua={regua}
      novo={novo}
      emAndamento={dto?.emAndamento ?? 0}
      cobrancas={exemplos}
      config={{
        fuso: config.fuso,
        horarioInicio: config.horarioInicio,
        horarioFim: config.horarioFim,
        diasSemana: config.diasSemana,
        nomeEmpresa: config.nomeEmpresa,
        nomeAtendente: config.nomeAtendente,
        chavePix: config.chavePix,
      }}
    />
  );
}
