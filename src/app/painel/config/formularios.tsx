"use client";

import { useActionState, useState } from "react";

import {
  AvisoForm,
  BotaoEnviar,
  Escolha,
  Opcoes,
  SwitchForm,
  erroDe,
} from "@/components/form";
import { Icon } from "@/components/icons";
import {
  Abas,
  Badge,
  Campo,
  Card,
  CardTitulo,
  Input,
  Select,
  Textarea,
} from "@/components/ui";
import { dataLonga } from "@/lib/format";
import { ESTADO_INICIAL } from "@/lib/form";
import { SEGMENTOS, TONS } from "@/lib/plans";
import { salvarConfigAction } from "@/server/actions/organizacao";
import type { ConfigOrg } from "@/server/dal/organizacao";

type AbaId = "atendente" | "conhecimento" | "notificacoes" | "conta";

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
  { valor: "responder", titulo: "Responder dúvidas", descricao: "Preço, endereço, horário, o que você faz." },
  { valor: "agendar", titulo: "Agendar horários", descricao: "A IA marca e te avisa no seu WhatsApp." },
  { valor: "cobrar", titulo: "Cobrar quem está devendo", descricao: "Lembrete antes, no dia e depois do vencimento." },
  { valor: "qualificar", titulo: "Qualificar interessados", descricao: "Separa curioso de quem quer comprar." },
  { valor: "orcamento", titulo: "Enviar orçamento", descricao: "Manda tabela e condições na hora." },
  { valor: "pos-venda", titulo: "Pós-venda", descricao: "Confirma entrega e pede avaliação." },
];

const FUSOS = [
  "America/Sao_Paulo",
  "America/Manaus",
  "America/Cuiaba",
  "America/Belem",
  "America/Fortaleza",
  "America/Recife",
  "America/Bahia",
  "America/Rio_Branco",
  "America/Noronha",
];

export function Formularios({
  config,
  email,
  admin,
  verFinanceiro,
  plano,
}: {
  config: ConfigOrg;
  email: string;
  admin: boolean;
  verFinanceiro: boolean;
  plano: { nome: string; status: string | null; expiraEm: string | null };
}) {
  const [aba, setAba] = useState<AbaId>("atendente");

  return (
    <>
      <Abas
        abas={[
          { id: "atendente", nome: "Atendente" },
          { id: "conhecimento", nome: "Conhecimento" },
          { id: "notificacoes", nome: "Notificações" },
          { id: "conta", nome: "Conta" },
        ]}
        ativa={aba}
        aoMudar={setAba}
      />

      {!admin && (
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-800 ring-1 ring-amber-200 ring-inset">
          <Icon name="lock" className="mt-0.5 size-3.5 shrink-0" />
          Você entrou como atendente: dá para ver como a IA está configurada, mas
          só quem administra a conta pode mudar.
        </p>
      )}

      <div className="mt-6">
        {aba === "atendente" && <AbaAtendente config={config} admin={admin} />}
        {aba === "conhecimento" && <AbaConhecimento config={config} admin={admin} />}
        {aba === "notificacoes" && <AbaNotificacoes config={config} admin={admin} />}
        {aba === "conta" && (
          <AbaConta
            config={config}
            admin={admin}
            email={email}
            verFinanceiro={verFinanceiro}
            plano={plano}
          />
        )}
      </div>
    </>
  );
}

/*
 * Um `<form>` por aba, cada um com seu próprio `useActionState`.
 *
 * Formulários separados porque `salvarConfig` é parcial: mandar só os campos da
 * aba evita sobrescrever com valor velho o que outra aba mostra, e um erro de
 * validação no horário não apaga o que a pessoa escreveu no conhecimento.
 */

function Rodape({ admin }: { admin: boolean }) {
  if (!admin) return null;
  return (
    <div className="flex justify-end border-t border-ink-100 px-5 py-4">
      <BotaoEnviar icone="check" enviando="Salvando...">
        Salvar ajustes
      </BotaoEnviar>
    </div>
  );
}

/* ------------------------------------------------------------- Atendente */

function AbaAtendente({ config, admin }: { config: ConfigOrg; admin: boolean }) {
  const [estado, acao] = useActionState(salvarConfigAction, ESTADO_INICIAL);

  return (
    <form action={acao} className="space-y-6">
      <fieldset disabled={!admin} className="space-y-6">
        <Card>
          <CardTitulo
            titulo="Identidade da atendente"
            subtitulo="É o nome e o jeito de falar que seus clientes vão ver no WhatsApp."
          />
          <div className="space-y-5 p-5">
            <AvisoForm estado={estado} />
            <Campo
              label="Nome da atendente"
              obrigatorio
              erro={erroDe(estado, "nomeAtendente")}
            >
              <Input
                name="nomeAtendente"
                defaultValue={config.nomeAtendente}
                placeholder="Ex.: Sofia"
              />
            </Campo>
            <Campo label="Tom de voz" erro={erroDe(estado, "tom")}>
              <div className="mt-2">
                {/*
                 * O exemplo embaixo de cada tom é o que faz a pessoa entender a
                 * diferença sem ter que mandar mensagem de teste pra si mesma.
                 */}
                <Escolha
                  name="tom"
                  padrao={config.tom}
                  itens={TONS.map((t) => ({
                    valor: t.id,
                    titulo: t.nome,
                    descricao: t.exemplo,
                  }))}
                />
              </div>
            </Campo>
          </div>
        </Card>

        <Card>
          <CardTitulo
            titulo="Chave da OpenAI (ChatGPT)"
            subtitulo="Cada organização paga o próprio consumo direto na OpenAI — sem custo extra aqui."
          />
          <div className="space-y-3 p-5">
            <Campo
              label="Chave da API"
              erro={erroDe(estado, "openaiApiKey")}
              dica={
                config.openaiChaveConfigurada
                  ? "Chave configurada. Deixe em branco para manter a atual, ou digite uma nova para substituir."
                  : "Sem chave configurada, a IA não consegue responder aos clientes."
              }
            >
              <Input
                name="openaiApiKey"
                type="password"
                autoComplete="off"
                placeholder={config.openaiChaveConfigurada ? "••••••••••••••••" : "sk-..."}
              />
            </Campo>
          </div>
          <Rodape admin={admin} />
        </Card>

        <Card>
          <CardTitulo
            titulo="Horário de atendimento"
            subtitulo="Fora dele a IA avisa quando você volta e nenhuma cobrança é disparada."
          />
          <div className="space-y-5 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo label="Começa" erro={erroDe(estado, "horarioInicio")}>
                <Input
                  name="horarioInicio"
                  type="time"
                  defaultValue={config.horarioInicio}
                />
              </Campo>
              <Campo label="Termina" erro={erroDe(estado, "horarioFim")}>
                <Input
                  name="horarioFim"
                  type="time"
                  defaultValue={config.horarioFim}
                />
              </Campo>
            </div>
            <Campo label="Dias da semana" erro={erroDe(estado, "diasSemana")}>
              <div className="mt-2">
                <Opcoes
                  name="diasSemana"
                  itens={DIAS}
                  padrao={config.diasSemana.map(String)}
                  colunas={3}
                />
              </div>
            </Campo>
          </div>
          <Rodape admin={admin} />
        </Card>
      </fieldset>
    </form>
  );
}

/* ---------------------------------------------------------- Conhecimento */

function AbaConhecimento({
  config,
  admin,
}: {
  config: ConfigOrg;
  admin: boolean;
}) {
  const [estado, acao] = useActionState(salvarConfigAction, ESTADO_INICIAL);

  return (
    <form action={acao}>
      <fieldset disabled={!admin} className="contents">
        <Card>
          <CardTitulo
            titulo="O que a IA sabe sobre o seu negócio"
            subtitulo="Quanto mais específico, menos ela inventa e menos você precisa corrigir."
          />
          <div className="space-y-5 p-5">
            <AvisoForm estado={estado} />
            <Campo
              label="O que ela deve fazer por você"
              dica="Dá para mudar quando quiser."
              erro={erroDe(estado, "objetivos")}
            >
              <div className="mt-2">
                <Opcoes
                  name="objetivos"
                  itens={OBJETIVOS}
                  padrao={config.objetivos}
                  colunas={2}
                />
              </div>
            </Campo>
            <Campo
              label="Instruções e respostas prontas"
              dica="Preços, regras, o que ela nunca deve prometer, dúvidas que se repetem."
              erro={erroDe(estado, "instrucoesExtra")}
            >
              {/*
               * Um campo de texto só, em vez da lista de "perguntas rápidas" do
               * protótipo: é isso que entra no prompt do modelo. Fingir um FAQ
               * estruturado que ninguém consulta só daria trabalho de digitação.
               */}
              <Textarea
                name="instrucoesExtra"
                rows={10}
                defaultValue={config.instrucoesExtra ?? ""}
                placeholder={
                  "Ex.: Primeira consulta custa R$ 150.\nNão atendemos convênio.\nEstacionamento gratuito na frente.\nFormas de pagamento: PIX, cartão em até 3x e dinheiro."
                }
              />
            </Campo>
          </div>
          <Rodape admin={admin} />
        </Card>
      </fieldset>
    </form>
  );
}

/* ---------------------------------------------------------- Notificações */

function AbaNotificacoes({
  config,
  admin,
}: {
  config: ConfigOrg;
  admin: boolean;
}) {
  const [estado, acao] = useActionState(salvarConfigAction, ESTADO_INICIAL);

  return (
    <form action={acao}>
      <fieldset disabled={!admin} className="contents">
        <Card>
          <CardTitulo
            titulo="Avisos no seu WhatsApp"
            subtitulo="A IA te chama no seu número pessoal quando algo precisa de você."
          />
          <div className="space-y-5 p-5">
            <AvisoForm estado={estado} />
            <Campo
              label="Seu WhatsApp pessoal"
              dica="Diferente do número de atendimento — é para onde os avisos vão."
              erro={erroDe(estado, "whatsappPessoal")}
            >
              <Input
                name="whatsappPessoal"
                type="tel"
                defaultValue={config.whatsappPessoal ?? ""}
                placeholder="(11) 98888-7777"
              />
            </Campo>

            {/*
             * Campo espelho: checkbox desmarcado não chega no FormData, então a
             * action precisa saber quais flags estavam na tela para distinguir
             * "desligou" de "nem apareceu".
             */}
            <input type="hidden" name="notificacoes" value="notificarNovoAgendamento" />
            <input type="hidden" name="notificacoes" value="notificarPagamento" />
            <input type="hidden" name="notificacoes" value="notificarSemResposta" />

            <div className="space-y-3">
              <div className="rounded-xl border border-ink-200 p-4">
                <SwitchForm
                  name="notificarNovoAgendamento"
                  padrao={config.notificarNovoAgendamento}
                  label="Novo agendamento"
                  descricao="Toda vez que a IA marcar um horário na sua agenda."
                />
              </div>
              <div className="rounded-xl border border-ink-200 p-4">
                <SwitchForm
                  name="notificarPagamento"
                  padrao={config.notificarPagamento}
                  label="Pagamento recebido"
                  descricao="Quando um cliente confirma que pagou uma cobrança."
                />
              </div>
              <div className="rounded-xl border border-ink-200 p-4">
                <SwitchForm
                  name="notificarSemResposta"
                  padrao={config.notificarSemResposta}
                  label="Cliente sem resposta"
                  descricao="Quando a IA não consegue resolver e alguém precisa entrar na conversa."
                />
              </div>
            </div>
          </div>
          <Rodape admin={admin} />
        </Card>
      </fieldset>
    </form>
  );
}

/* ------------------------------------------------------------------ Conta */

function AbaConta({
  config,
  admin,
  email,
  verFinanceiro,
  plano,
}: {
  config: ConfigOrg;
  admin: boolean;
  email: string;
  verFinanceiro: boolean;
  plano: { nome: string; status: string | null; expiraEm: string | null };
}) {
  const [estado, acao] = useActionState(salvarConfigAction, ESTADO_INICIAL);

  return (
    <div className="space-y-6">
      <form action={acao}>
        <fieldset disabled={!admin} className="contents">
          <Card>
            <CardTitulo
              titulo="Dados da empresa"
              subtitulo="Nome e fuso que a IA usa ao falar com seus clientes."
            />
            <div className="space-y-5 p-5">
              <AvisoForm estado={estado} />
              <Campo
                label="Nome da empresa"
                obrigatorio
                erro={erroDe(estado, "nomeEmpresa")}
              >
                <Input name="nomeEmpresa" defaultValue={config.nomeEmpresa} />
              </Campo>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo label="Segmento" erro={erroDe(estado, "segmento")}>
                  <Select name="segmento" defaultValue={config.segmento ?? ""}>
                    <option value="">Selecione...</option>
                    {SEGMENTOS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                </Campo>
                <Campo
                  label="Fuso horário"
                  dica="Base para horários de atendimento e disparos."
                  erro={erroDe(estado, "fuso")}
                >
                  <Select name="fuso" defaultValue={config.fuso}>
                    {FUSOS.map((f) => (
                      <option key={f} value={f}>
                        {f.replace("America/", "").replaceAll("_", " ")}
                      </option>
                    ))}
                  </Select>
                </Campo>
              </div>
              <Campo
                label="Chave PIX"
                dica="Vai nas cobranças que a IA envia. Deixe em branco para não cobrar por PIX."
                erro={erroDe(estado, "chavePix")}
              >
                <Input
                  name="chavePix"
                  defaultValue={config.chavePix ?? ""}
                  placeholder="CNPJ, e-mail ou telefone"
                />
              </Campo>
              <Campo label="E-mail de acesso">
                {/*
                 * Só leitura: trocar e-mail muda como se entra na conta e pede
                 * confirmação por e-mail. Um input editável aqui prometeria algo
                 * que a action não faz.
                 */}
                <Input value={email} readOnly disabled />
              </Campo>
            </div>
            <Rodape admin={admin} />
          </Card>
        </fieldset>
      </form>

      <Card>
        <CardTitulo titulo="Assinatura" subtitulo="Plano e cobrança da conta" />
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <p className="flex items-center gap-2 text-sm font-medium text-ink-900">
              {plano.nome}
              {plano.status === "trial" && <Badge tom="info">Teste grátis</Badge>}
              {plano.status === "inadimplente" && (
                <Badge tom="perigo">Em atraso</Badge>
              )}
            </p>
            {plano.expiraEm && (
              <p className="mt-0.5 text-[13px] text-ink-500">
                {plano.status === "trial" ? "Teste até" : "Renova em"}{" "}
                {dataLonga(plano.expiraEm)}
              </p>
            )}
          </div>
          {verFinanceiro && (
            <a
              href="/painel/creditos"
              className="inline-flex items-center gap-1.5 rounded-xl border border-ink-200 px-3.5 py-2 text-[13px] font-medium text-ink-700 transition-colors hover:bg-ink-50"
            >
              Ver plano e faturas
              <Icon name="arrowRight" className="size-3.5" />
            </a>
          )}
        </div>
        <p className="border-t border-ink-100 px-5 py-4 text-[13px] leading-relaxed text-ink-500">
          {/*
           * O protótipo tinha "Encerrar assinatura" com modal e toast, sem nada
           * atrás. O encerramento de verdade é desligar a renovação: o acesso
           * continua até o fim do período já pago.
           */}
          Para encerrar, desligue a renovação automática em Plano e créditos. Seu
          acesso continua até o fim do período já pago e nada é cobrado depois.
        </p>
      </Card>

      <p className="px-1 text-xs text-ink-400">
        Organização <code className="font-mono">{config.slug}</code>
      </p>
    </div>
  );
}
