"use client";

import { useState } from "react";
import { Pagina } from "@/components/shell";
import {
  Abas,
  Badge,
  Botao,
  Campo,
  Card,
  CardTitulo,
  Input,
  Modal,
  Select,
  Switch,
  Textarea,
  cx,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import { useApp } from "@/lib/store";
import { SEGMENTOS, TONS } from "@/lib/plans";
import { dataLonga } from "@/lib/format";

type AbaId = "atendente" | "conhecimento" | "notificacoes" | "conta";

interface PerguntaRapida {
  id: string;
  pergunta: string;
  resposta: string;
}

const PERGUNTAS_INICIAIS: PerguntaRapida[] = [
  {
    id: "pr_1",
    pergunta: "Vocês têm estacionamento?",
    resposta: "Sim! Temos vagas gratuitas na frente do prédio.",
  },
  {
    id: "pr_2",
    pergunta: "Quais formas de pagamento vocês aceitam?",
    resposta: "PIX, cartão de crédito (até 3x sem juros) e dinheiro.",
  },
];

export default function ConfigPage() {
  const [aba, setAba] = useState<AbaId>("atendente");

  return (
    <Pagina
      titulo="Ajustes da IA"
      descricao="Configure como a sua atendente virtual se comporta no WhatsApp."
    >
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

      <div className="mt-6">
        {aba === "atendente" && <AbaAtendente />}
        {aba === "conhecimento" && <AbaConhecimento />}
        {aba === "notificacoes" && <AbaNotificacoes />}
        {aba === "conta" && <AbaConta />}
      </div>
    </Pagina>
  );
}

/* ------------------------------------------------------------- Atendente */

function AbaAtendente() {
  const app = useApp();
  const [nomeAtendente, setNomeAtendente] = useState(app.conta.nomeAtendente);
  const [tom, setTom] = useState(app.conta.tom);
  const [horario, setHorario] = useState(app.conta.horarioAtendimento);
  const [boasVindas, setBoasVindas] = useState(
    `Oi! Aqui é a ${app.conta.nomeAtendente || "atendente"} da ${app.conta.nomeEmpresa || "empresa"} 😊 Como posso te ajudar hoje?`,
  );
  const [avisarForaHorario, setAvisarForaHorario] = useState(true);

  const tomAtual = TONS.find((t) => t.id === tom) ?? TONS[0];

  function salvar() {
    app.atualizarConta({
      nomeAtendente: nomeAtendente.trim(),
      tom,
      horarioAtendimento: horario.trim(),
    });
    app.notificar("Ajustes salvos");
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardTitulo
            titulo="Identidade da atendente"
            subtitulo="É o nome e o jeito de falar que seus clientes vão ver no WhatsApp."
          />
          <div className="space-y-4 p-5">
            <Campo label="Nome da atendente" obrigatorio>
              <Input
                value={nomeAtendente}
                onChange={(e) => setNomeAtendente(e.target.value)}
                placeholder="Ex.: Sofia"
              />
            </Campo>
            <Campo label="Horário de atendimento">
              <Input
                value={horario}
                onChange={(e) => setHorario(e.target.value)}
                placeholder="Ex.: Seg a Sex, 08h às 19h"
              />
            </Campo>
          </div>
        </Card>

        <Card>
          <CardTitulo titulo="Tom de voz" subtitulo="Como a IA fala com seus clientes." />
          <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-3">
            {TONS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTom(t.id)}
                className={cx(
                  "rounded-xl border p-3.5 text-left transition-colors",
                  tom === t.id
                    ? "border-brand-400 bg-brand-50/60 ring-1 ring-brand-300"
                    : "border-ink-200 hover:border-ink-300",
                )}
              >
                <p className="text-[13.5px] font-semibold text-ink-900">
                  {t.nome}
                </p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">
                  {t.exemplo}
                </p>
              </button>
            ))}
          </div>
        </Card>

        <Card>
          <CardTitulo
            titulo="Mensagem de boas-vindas"
            subtitulo="A primeira coisa que o cliente lê ao mandar mensagem."
          />
          <div className="p-5">
            <Textarea
              rows={3}
              value={boasVindas}
              onChange={(e) => setBoasVindas(e.target.value)}
            />
            <div className="mt-4 border-t border-ink-100 pt-4">
              <Switch
                ativo={avisarForaHorario}
                onChange={setAvisarForaHorario}
                label="Responder fora do horário avisando o horário de funcionamento"
                descricao="Se o cliente escrever fora do expediente, a IA avisa quando você volta a atender."
              />
            </div>
          </div>
        </Card>

        <div className="flex justify-end">
          <Botao icone="check" onClick={salvar}>
            Salvar ajustes
          </Botao>
        </div>
      </div>

      {/* Preview */}
      <div>
        <Card className="sticky top-6 overflow-hidden">
          <CardTitulo titulo="Prévia ao vivo" subtitulo="Assim a IA se apresenta." />
          <div className="chat-bg p-4">
            <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-[#d9fdd3] px-3.5 py-2.5 text-[13.5px] leading-relaxed text-ink-900 shadow-sm">
              <span className="mb-1 inline-block rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-700">
                IA
              </span>
              <p className="whitespace-pre-line">
                {boasVindas || "Escreva uma mensagem de boas-vindas acima."}
              </p>
            </div>
            <p className="mt-3 text-center text-[11px] text-ink-500">
              Tom: {tomAtual.nome} · {nomeAtendente || "sem nome"} ·{" "}
              {horario || "horário não definido"}
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- Conhecimento */

function AbaConhecimento() {
  const app = useApp();
  const [conhecimento, setConhecimento] = useState(
    "Ex.: Somos uma clínica de estética. Atendemos de segunda a sexta, das 8h às 19h.\n" +
      "Serviços e preços:\n- Limpeza de pele: R$ 280\n- Avaliação facial: gratuita\n- Pacote 4 sessões: R$ 960\n\n" +
      "Endereço: Rua das Flores, 123 — Centro\nFormas de pagamento: PIX, cartão (até 3x) e dinheiro.",
  );
  const [perguntas, setPerguntas] = useState<PerguntaRapida[]>(
    PERGUNTAS_INICIAIS,
  );
  const [novaPergunta, setNovaPergunta] = useState("");
  const [novaResposta, setNovaResposta] = useState("");

  function adicionar() {
    if (!novaPergunta.trim() || !novaResposta.trim()) return;
    setPerguntas((prev) => [
      ...prev,
      {
        id: `pr_${Date.now().toString(36)}`,
        pergunta: novaPergunta.trim(),
        resposta: novaResposta.trim(),
      },
    ]);
    setNovaPergunta("");
    setNovaResposta("");
  }

  function remover(id: string) {
    setPerguntas((prev) => prev.filter((p) => p.id !== id));
  }

  function salvar() {
    app.notificar("Ajustes salvos");
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardTitulo
          titulo="O que a IA precisa saber sobre o seu negócio"
          subtitulo="Serviços, preços, endereço, formas de pagamento — quanto mais completo, melhor a IA responde."
        />
        <div className="p-5">
          <Textarea
            rows={10}
            value={conhecimento}
            onChange={(e) => setConhecimento(e.target.value)}
            placeholder="Descreva seus serviços, preços, endereço e formas de pagamento…"
          />
          <p className="mt-3 flex items-start gap-1.5 text-[12.5px] text-ink-500">
            <Icon name="alert" className="mt-0.5 size-3.5 shrink-0 text-ink-400" />
            Na versão final você vai poder subir PDF, cardápio ou tabela de preços
            direto aqui, sem precisar digitar tudo.
          </p>
        </div>
      </Card>

      <Card>
        <CardTitulo
          titulo="Perguntas e respostas rápidas"
          subtitulo="Perguntas comuns que a IA já responde de cabeça."
        />
        <div className="space-y-3 p-5">
          {perguntas.length === 0 ? (
            <p className="text-sm text-ink-400">Nenhuma pergunta cadastrada ainda.</p>
          ) : (
            <ul className="space-y-2.5">
              {perguntas.map((p) => (
                <li
                  key={p.id}
                  className="flex items-start justify-between gap-3 rounded-xl border border-ink-200 p-3.5"
                >
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-medium text-ink-900">
                      {p.pergunta}
                    </p>
                    <p className="mt-0.5 text-[13px] text-ink-500">
                      {p.resposta}
                    </p>
                  </div>
                  <button
                    onClick={() => remover(p.id)}
                    aria-label="Remover pergunta"
                    className="shrink-0 rounded-lg p-1.5 text-ink-400 hover:bg-rose-50 hover:text-rose-600"
                  >
                    <Icon name="trash" className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="grid grid-cols-1 gap-3 rounded-xl bg-ink-50 p-3.5 sm:grid-cols-2">
            <Campo label="Pergunta">
              <Input
                value={novaPergunta}
                onChange={(e) => setNovaPergunta(e.target.value)}
                placeholder="Ex.: Vocês atendem aos sábados?"
              />
            </Campo>
            <Campo label="Resposta">
              <Input
                value={novaResposta}
                onChange={(e) => setNovaResposta(e.target.value)}
                placeholder="Ex.: Sim, das 9h às 13h."
              />
            </Campo>
            <div className="sm:col-span-2">
              <Botao variante="secundario" icone="plus" onClick={adicionar}>
                Adicionar pergunta
              </Botao>
            </div>
          </div>
        </div>
      </Card>

      <div className="flex justify-end">
        <Botao icone="check" onClick={salvar}>
          Salvar ajustes
        </Botao>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- Notificações */

function AbaNotificacoes() {
  const app = useApp();
  const [whatsapp, setWhatsapp] = useState(app.conta.whatsappPessoal);

  function salvar() {
    app.atualizarConta({ whatsappPessoal: whatsapp.trim() });
    app.notificar("Ajustes salvos");
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card>
        <CardTitulo
          titulo="Seu WhatsApp pessoal"
          subtitulo="É pra onde vão os avisos importantes."
        />
        <div className="p-5">
          <Campo label="Número com DDD">
            <Input
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="Ex.: 5511987654321"
            />
          </Campo>
        </div>
      </Card>

      <Card>
        <CardTitulo titulo="O que te avisa" />
        <div className="space-y-5 p-5">
          <Switch
            ativo={app.conta.notificarNovoAgendamento}
            onChange={(v) => app.atualizarConta({ notificarNovoAgendamento: v })}
            label="Novo agendamento"
            descricao="Avisa toda vez que a IA marcar um horário novo."
          />
          <Switch
            ativo={app.conta.notificarPagamento}
            onChange={(v) => app.atualizarConta({ notificarPagamento: v })}
            label="Pagamento recebido"
            descricao="Avisa quando um cliente pagar uma cobrança."
          />
          <Switch
            ativo={app.conta.notificarSemResposta}
            onChange={(v) => app.atualizarConta({ notificarSemResposta: v })}
            label="Cliente sem resposta"
            descricao="Avisa quando um cliente fica muito tempo sem responder a IA."
          />
        </div>
      </Card>

      <div className="flex justify-end">
        <Botao icone="check" onClick={salvar}>
          Salvar ajustes
        </Botao>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Conta */

function AbaConta() {
  const app = useApp();
  const [nomeEmpresa, setNomeEmpresa] = useState(app.conta.nomeEmpresa);
  const [segmento, setSegmento] = useState(app.conta.segmento);
  const [email, setEmail] = useState(app.conta.email);
  const [modalEncerrar, setModalEncerrar] = useState(false);

  function salvar() {
    app.atualizarConta({
      nomeEmpresa: nomeEmpresa.trim(),
      segmento,
      email: email.trim(),
    });
    app.notificar("Ajustes salvos");
  }

  function encerrar() {
    setModalEncerrar(false);
    app.notificar("Assinatura marcada para encerramento no fim do período.", "info");
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card>
        <CardTitulo titulo="Dados da empresa" />
        <div className="space-y-4 p-5">
          <Campo label="Nome da empresa" obrigatorio>
            <Input
              value={nomeEmpresa}
              onChange={(e) => setNomeEmpresa(e.target.value)}
            />
          </Campo>
          <Campo label="Segmento">
            <Select value={segmento} onChange={(e) => setSegmento(e.target.value)}>
              <option value="">Selecione…</option>
              {SEGMENTOS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Campo>
          <Campo label="E-mail de contato">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Campo>
        </div>
      </Card>

      <div className="flex justify-end">
        <Botao icone="check" onClick={salvar}>
          Salvar ajustes
        </Botao>
      </div>

      <Card className="border-rose-200">
        <CardTitulo
          titulo="Zona de perigo"
          subtitulo="Ações que afetam sua assinatura."
        />
        <div className="flex items-center justify-between gap-4 p-5">
          <div>
            <p className="text-[13.5px] font-medium text-ink-800">
              Encerrar assinatura
            </p>
            <p className="mt-0.5 text-[13px] text-ink-500">
              A IA para de atender, cobrar e agendar no fim do período pago.
            </p>
          </div>
          <Botao
            variante="perigo"
            tamanho="sm"
            onClick={() => setModalEncerrar(true)}
          >
            Encerrar
          </Botao>
        </div>
      </Card>

      <Modal
        aberto={modalEncerrar}
        aoFechar={() => setModalEncerrar(false)}
        titulo="Encerrar assinatura"
        subtitulo="Essa ação não pode ser desfeita."
        rodape={
          <>
            <Botao variante="secundario" onClick={() => setModalEncerrar(false)}>
              Voltar
            </Botao>
            <Botao variante="perigo" onClick={encerrar}>
              Confirmar encerramento
            </Botao>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-ink-600">
          Sua IA vai continuar ativa até{" "}
          <Badge tom="neutro" className="mx-0.5">
            {dataLonga(app.conta.expiraEm)}
          </Badge>{" "}
          (fim do período já pago) e depois disso para de atender, cobrar e
          agendar automaticamente. No protótipo, isso apenas simula a
          solicitação.
        </p>
      </Modal>
    </div>
  );
}
