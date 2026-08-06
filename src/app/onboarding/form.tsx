"use client";

import { useActionState, useState } from "react";

import { AvisoForm, BotaoEnviar, Escolha, Opcoes, erroDe } from "@/components/form";
import { Icon } from "@/components/icons";
import { Botao, Campo, Input, Select } from "@/components/ui";
import { cx } from "@/lib/cx";
import { ESTADO_INICIAL } from "@/lib/form";
import { SEGMENTOS, TONS } from "@/lib/plans";
import { salvarOnboardingAction } from "@/server/actions/organizacao";

/**
 * Onboarding em 3 passos dentro de UM formulário só.
 *
 * Os passos escondem/mostram `<fieldset>`s em vez de desmontá-los: assim tudo
 * que a pessoa respondeu no passo 1 continua no DOM e chega no FormData do
 * submit final, sem estado espelhado em React nem rascunho no localStorage.
 * Como o `<form>` inteiro é submetido de uma vez, a action valida o conjunto —
 * que é o que a DAL exige (`EntradaOnboarding` é tudo obrigatório junto).
 */

const PASSOS = ["Seu negócio", "Sua atendente", "Horário de atendimento"];

const DIAS = [
  { valor: "1", titulo: "Seg" },
  { valor: "2", titulo: "Ter" },
  { valor: "3", titulo: "Qua" },
  { valor: "4", titulo: "Qui" },
  { valor: "5", titulo: "Sex" },
  { valor: "6", titulo: "Sáb" },
  { valor: "0", titulo: "Dom" },
];

const OBJETIVOS = [
  {
    valor: "responder",
    titulo: "Responder dúvidas",
    descricao: "Preço, endereço, horário, o que você faz.",
  },
  {
    valor: "agendar",
    titulo: "Agendar horários",
    descricao: "A IA marca e te avisa no seu WhatsApp.",
  },
  {
    valor: "cobrar",
    titulo: "Cobrar quem está devendo",
    descricao: "Lembrete antes, no dia e depois do vencimento.",
  },
  {
    valor: "qualificar",
    titulo: "Qualificar interessados",
    descricao: "Separa curioso de quem quer comprar.",
  },
  {
    valor: "orcamento",
    titulo: "Enviar orçamento",
    descricao: "Manda tabela e condições na hora.",
  },
  {
    valor: "pos-venda",
    titulo: "Pós-venda",
    descricao: "Confirma entrega e pede avaliação.",
  },
];

export function FormOnboarding({
  nomeEmpresa,
  segmento,
}: {
  nomeEmpresa: string;
  segmento: string | null;
}) {
  const [estado, acao] = useActionState(salvarOnboardingAction, ESTADO_INICIAL);
  const [passo, setPasso] = useState(0);
  const ultimo = passo === PASSOS.length - 1;

  return (
    <form action={acao} className="space-y-6">
      {/* Trilha */}
      <ol className="flex items-center gap-2">
        {PASSOS.map((nome, i) => (
          <li key={nome} className="flex flex-1 items-center gap-2">
            <span
              className={cx(
                "flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold transition-colors",
                i < passo && "bg-brand-600 text-white",
                i === passo && "bg-brand-600 text-white ring-4 ring-brand-500/15",
                i > passo && "bg-ink-100 text-ink-400",
              )}
            >
              {i < passo ? <Icon name="check" className="size-3.5" /> : i + 1}
            </span>
            <span
              className={cx(
                "hidden text-[13px] sm:block",
                i === passo ? "font-medium text-ink-800" : "text-ink-400",
              )}
            >
              {nome}
            </span>
            {i < PASSOS.length - 1 && (
              <span className="h-px flex-1 bg-ink-200" aria-hidden />
            )}
          </li>
        ))}
      </ol>

      <AvisoForm estado={estado} />

      {/* Passo 1 — negócio */}
      <fieldset className={cx("space-y-4", passo !== 0 && "hidden")}>
        <legend className="sr-only">Seu negócio</legend>
        <p className="text-[14px] text-ink-500">
          Isso ajuda a IA a falar como alguém de dentro da{" "}
          <strong className="font-medium text-ink-700">{nomeEmpresa}</strong>.
        </p>
        <Campo label="Segmento" erro={erroDe(estado, "segmento")}>
          <Select name="segmento" defaultValue={segmento ?? ""}>
            <option value="">Selecione...</option>
            {SEGMENTOS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Campo>
        <Campo
          label="O que a IA deve fazer por você?"
          dica="Pode marcar mais de um. Dá para mudar depois."
          erro={erroDe(estado, "objetivos")}
        >
          <div className="mt-2">
            <Opcoes
              name="objetivos"
              itens={OBJETIVOS}
              padrao={["responder", "agendar"]}
              colunas={2}
            />
          </div>
        </Campo>
      </fieldset>

      {/* Passo 2 — atendente */}
      <fieldset className={cx("space-y-4", passo !== 1 && "hidden")}>
        <legend className="sr-only">Sua atendente</legend>
        <Campo
          label="Nome da atendente virtual"
          obrigatorio
          dica="É esse nome que o cliente vê no WhatsApp."
          erro={erroDe(estado, "nomeAtendente")}
        >
          <Input name="nomeAtendente" placeholder="Ex: Sofia" defaultValue="Sofia" />
        </Campo>
        <Campo label="Tom de voz" erro={erroDe(estado, "tom")}>
          <div className="mt-2">
            <Escolha
              name="tom"
              padrao="amigavel"
              itens={TONS.map((t) => ({
                valor: t.id,
                titulo: t.nome,
                descricao: t.exemplo,
              }))}
            />
          </div>
        </Campo>
        <Campo
          label="Algo que ela precisa saber?"
          dica="Regras, promoções, o que ela nunca deve prometer."
          erro={erroDe(estado, "instrucoesExtra")}
        >
          <textarea
            name="instrucoesExtra"
            rows={4}
            placeholder="Ex: primeira consulta custa R$ 150. Não atendemos convênio. Estacionamento é gratuito."
            className="w-full rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-900 placeholder:text-ink-400 transition-colors focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/10"
          />
        </Campo>
      </fieldset>

      {/* Passo 3 — horário */}
      <fieldset className={cx("space-y-4", passo !== 2 && "hidden")}>
        <legend className="sr-only">Horário de atendimento</legend>
        <p className="text-[14px] text-ink-500">
          Fora desse horário a IA avisa que você retorna e não dispara cobrança.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <Campo label="Começa" erro={erroDe(estado, "horarioInicio")}>
            <Input name="horarioInicio" type="time" defaultValue="09:00" />
          </Campo>
          <Campo label="Termina" erro={erroDe(estado, "horarioFim")}>
            <Input name="horarioFim" type="time" defaultValue="18:00" />
          </Campo>
        </div>
        <Campo label="Dias da semana" erro={erroDe(estado, "diasSemana")}>
          <div className="mt-2">
            <Opcoes
              name="diasSemana"
              itens={DIAS}
              padrao={["1", "2", "3", "4", "5"]}
              colunas={3}
            />
          </div>
        </Campo>
        <Campo
          label="Seu WhatsApp pessoal"
          dica="Para onde mandamos aviso de agendamento e pagamento."
          erro={erroDe(estado, "whatsappPessoal")}
        >
          <Input name="whatsappPessoal" placeholder="(11) 98765-4321" />
        </Campo>
        <Campo
          label="Chave PIX"
          dica="Vai junto nas cobranças automáticas."
          erro={erroDe(estado, "chavePix")}
        >
          <Input name="chavePix" placeholder="CNPJ, e-mail ou telefone" />
        </Campo>
      </fieldset>

      <input type="hidden" name="fuso" value="America/Sao_Paulo" />

      <div className="flex items-center justify-between border-t border-ink-100 pt-5">
        <Botao
          type="button"
          variante="fantasma"
          onClick={() => setPasso((p) => Math.max(0, p - 1))}
          className={cx(passo === 0 && "invisible")}
        >
          Voltar
        </Botao>

        {ultimo ? (
          <BotaoEnviar variante="primario" tamanho="lg" enviando="Salvando...">
            Concluir e ir para o painel
          </BotaoEnviar>
        ) : (
          <Botao
            type="button"
            variante="primario"
            tamanho="lg"
            onClick={() => setPasso((p) => p + 1)}
          >
            Continuar
          </Botao>
        )}
      </div>
    </form>
  );
}
