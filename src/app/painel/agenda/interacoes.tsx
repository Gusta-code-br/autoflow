"use client";

import { useActionState, useEffect, useState } from "react";

import {
  AvisoForm,
  BotaoAcao,
  BotaoEnviar,
  SwitchForm,
  erroDe,
  valorDe,
} from "@/components/form";
import { useToastEstado } from "@/components/toast";
import { Botao, Campo, Input, Modal, Select, Textarea } from "@/components/ui";
import { ESTADO_INICIAL, type EstadoForm } from "@/lib/form";
import {
  criarAgendamentoAction,
  criarBloqueioAction,
  mudarStatusAction,
  removerBloqueioAction,
  salvarServicoAction,
} from "@/server/actions/agenda";
import type { ServicoDTO } from "@/server/dal/agenda";

/**
 * Os pedaços da Agenda que precisam de browser.
 *
 * A lista e a navegação por dia são servidor puro (links com `?dia=`). Aqui
 * ficam só os modais e os botões de status — cada um é um `<form>` de verdade,
 * então o clique funciona antes do JS terminar de carregar.
 */

/**
 * Fecha o modal quando a action volta ok.
 *
 * Em efeito, e não durante o render: o resultado só existe depois que o
 * servidor respondeu, e fechar no meio do render tiraria o form da tela antes
 * de `useActionState` ter terminado de aplicar o estado novo.
 */
function useFechaAoSalvar(estado: EstadoForm, fechar: () => void) {
  useEffect(() => {
    if (estado.ok) fechar();
    // `fechar` é estável o bastante: é sempre um setState do dono do modal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);
}

/* ------------------------------------------------------- Novo agendamento */

export function BotaoNovo({
  dia,
  servicos,
}: {
  dia: string;
  servicos: ServicoDTO[];
}) {
  const [aberto, setAberto] = useState(false);
  const [estado, acao] = useActionState(criarAgendamentoAction, ESTADO_INICIAL);

  useFechaAoSalvar(estado, () => setAberto(false));
  useToastEstado(estado);

  return (
    <>
      <Botao icone="plus" onClick={() => setAberto(true)}>
        Novo horário
      </Botao>

      <Modal
        aberto={aberto}
        aoFechar={() => setAberto(false)}
        titulo="Novo horário"
        subtitulo="Marcado por você aqui ou pela IA no WhatsApp, cai na mesma agenda."
        largura="max-w-xl"
      >
        <form action={acao} className="space-y-4">
          <AvisoForm estado={estado} />

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo label="Cliente" obrigatorio erro={erroDe(estado, "contatoNome")}>
              <Input
                name="contatoNome"
                placeholder="Maria Souza"
                defaultValue={valorDe(estado, "contatoNome")}
                required
              />
            </Campo>
            <Campo
              label="WhatsApp"
              obrigatorio
              erro={erroDe(estado, "contatoTelefone")}
            >
              <Input
                name="contatoTelefone"
                placeholder="(11) 98888-7777"
                defaultValue={valorDe(estado, "contatoTelefone")}
                required
              />
            </Campo>
          </div>

          <Campo
            label="Serviço"
            erro={erroDe(estado, "servicoId")}
            dica="A duração vem do serviço; ajuste abaixo se este caso for diferente."
          >
            <Select name="servicoId" defaultValue={valorDe(estado, "servicoId")}>
              <option value="">Sem serviço</option>
              {servicos.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nome} · {s.duracaoMin} min
                </option>
              ))}
            </Select>
          </Campo>

          <div className="grid gap-4 sm:grid-cols-3">
            <Campo label="Data" obrigatorio erro={erroDe(estado, "data")}>
              <Input
                type="date"
                name="data"
                defaultValue={valorDe(estado, "data", dia)}
                required
              />
            </Campo>
            <Campo label="Hora" obrigatorio erro={erroDe(estado, "hora")}>
              <Input
                type="time"
                name="hora"
                defaultValue={valorDe(estado, "hora", "09:00")}
                required
              />
            </Campo>
            <Campo label="Duração (min)" erro={erroDe(estado, "duracaoMin")}>
              <Input
                type="number"
                name="duracaoMin"
                min={5}
                max={600}
                step={5}
                defaultValue={valorDe(estado, "duracaoMin", "60")}
              />
            </Campo>
          </div>

          <Campo label="Observação" erro={erroDe(estado, "observacao")}>
            <Textarea
              name="observacao"
              rows={2}
              placeholder="Cliente pediu para avisar 1h antes."
              defaultValue={valorDe(estado, "observacao")}
            />
          </Campo>

          <div className="flex justify-end gap-2">
            <Botao
              type="button"
              variante="secundario"
              onClick={() => setAberto(false)}
            >
              Cancelar
            </Botao>
            <BotaoEnviar enviando="Marcando…">Marcar horário</BotaoEnviar>
          </div>
        </form>
      </Modal>
    </>
  );
}

/* ----------------------------------------------------- Status do horário */

const PROXIMOS: Record<string, { status: string; rotulo: string }[]> = {
  pendente: [
    { status: "confirmado", rotulo: "Confirmar" },
    { status: "cancelado", rotulo: "Cancelar" },
  ],
  confirmado: [
    { status: "concluido", rotulo: "Atendido" },
    { status: "faltou", rotulo: "Faltou" },
    { status: "cancelado", rotulo: "Cancelar" },
  ],
  concluido: [],
  faltou: [],
  cancelado: [{ status: "pendente", rotulo: "Reabrir" }],
};

export function AcoesAgendamento({ id, status }: { id: string; status: string }) {
  const [estado, acao] = useActionState(mudarStatusAction, ESTADO_INICIAL);
  useToastEstado(estado);
  const opcoes = PROXIMOS[status] ?? [];
  if (opcoes.length === 0) return null;

  return (
    <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
      {opcoes.map((o) => (
        <form key={o.status} action={acao}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="status" value={o.status} />
          <BotaoAcao
            variante={o.status === "cancelado" ? "fantasma" : "secundario"}
            tamanho="sm"
            confirmar={
              o.status === "cancelado"
                ? "Cancelar este horário? O cliente não é avisado automaticamente."
                : undefined
            }
          >
            {o.rotulo}
          </BotaoAcao>
        </form>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- Bloqueio */

export function BotaoBloquear({ dia }: { dia: string }) {
  const [aberto, setAberto] = useState(false);
  const [estado, acao] = useActionState(criarBloqueioAction, ESTADO_INICIAL);

  useFechaAoSalvar(estado, () => setAberto(false));
  useToastEstado(estado);

  return (
    <>
      <Botao variante="secundario" icone="clock" onClick={() => setAberto(true)}>
        Bloquear
      </Botao>

      <Modal
        aberto={aberto}
        aoFechar={() => setAberto(false)}
        titulo="Bloquear horário"
        subtitulo="Almoço, médico, folga: a IA não oferece esse intervalo para ninguém."
      >
        <form action={acao} className="space-y-4">
          <AvisoForm estado={estado} />

          <Campo label="Data" obrigatorio erro={erroDe(estado, "data")}>
            <Input
              type="date"
              name="data"
              defaultValue={valorDe(estado, "data", dia)}
              required
            />
          </Campo>

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo label="Das" obrigatorio erro={erroDe(estado, "horaInicio")}>
              <Input
                type="time"
                name="horaInicio"
                defaultValue={valorDe(estado, "horaInicio", "12:00")}
                required
              />
            </Campo>
            <Campo label="Até" obrigatorio erro={erroDe(estado, "horaFim")}>
              <Input
                type="time"
                name="horaFim"
                defaultValue={valorDe(estado, "horaFim", "13:00")}
                required
              />
            </Campo>
          </div>

          <Campo label="Motivo" erro={erroDe(estado, "motivo")}>
            <Input
              name="motivo"
              placeholder="Almoço"
              defaultValue={valorDe(estado, "motivo")}
            />
          </Campo>

          <div className="flex justify-end gap-2">
            <Botao
              type="button"
              variante="secundario"
              onClick={() => setAberto(false)}
            >
              Cancelar
            </Botao>
            <BotaoEnviar enviando="Bloqueando…">Bloquear</BotaoEnviar>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function BotaoRemoverBloqueio({ id }: { id: string }) {
  const [estado, acao] = useActionState(removerBloqueioAction, ESTADO_INICIAL);
  useToastEstado(estado);
  return (
    <form action={acao}>
      <input type="hidden" name="id" value={id} />
      <BotaoAcao variante="fantasma" tamanho="sm" icone="trash">
        Liberar
      </BotaoAcao>
    </form>
  );
}

/* --------------------------------------------------------------- Serviços */

export function BotaoServico({ servico }: { servico?: ServicoDTO }) {
  const [aberto, setAberto] = useState(false);
  const [estado, acao] = useActionState(salvarServicoAction, ESTADO_INICIAL);

  useFechaAoSalvar(estado, () => setAberto(false));
  useToastEstado(estado);

  const editar = servico !== undefined;

  return (
    <>
      {editar ? (
        <Botao
          variante="fantasma"
          tamanho="sm"
          icone="edit"
          onClick={() => setAberto(true)}
          aria-label={`Editar ${servico.nome}`}
        />
      ) : (
        <Botao variante="secundario" tamanho="sm" icone="plus" onClick={() => setAberto(true)}>
          Novo
        </Botao>
      )}

      <Modal
        aberto={aberto}
        aoFechar={() => setAberto(false)}
        titulo={editar ? "Editar serviço" : "Novo serviço"}
        subtitulo="A duração define os encaixes que a IA oferece para o cliente."
      >
        <form action={acao} className="space-y-4">
          <AvisoForm estado={estado} />
          {editar && <input type="hidden" name="id" value={servico.id} />}

          <Campo label="Nome" obrigatorio erro={erroDe(estado, "nome")}>
            <Input
              name="nome"
              placeholder="Corte masculino"
              defaultValue={valorDe(estado, "nome", servico?.nome ?? "")}
              required
            />
          </Campo>

          <div className="grid gap-4 sm:grid-cols-3">
            <Campo label="Duração (min)" obrigatorio erro={erroDe(estado, "duracaoMin")}>
              <Input
                type="number"
                name="duracaoMin"
                min={5}
                max={600}
                step={5}
                defaultValue={valorDe(
                  estado,
                  "duracaoMin",
                  String(servico?.duracaoMin ?? 30),
                )}
                required
              />
            </Campo>
            <Campo
              label="Intervalo (min)"
              erro={erroDe(estado, "intervaloMin")}
              dica="Folga entre um cliente e outro."
            >
              <Input
                type="number"
                name="intervaloMin"
                min={0}
                max={240}
                step={5}
                defaultValue={valorDe(
                  estado,
                  "intervaloMin",
                  String(servico?.intervaloMin ?? 0),
                )}
              />
            </Campo>
            <Campo label="Preço" erro={erroDe(estado, "preco")} dica="Em reais.">
              <Input
                name="preco"
                inputMode="decimal"
                placeholder="80,00"
                defaultValue={valorDe(
                  estado,
                  "preco",
                  servico?.preco != null ? (servico.preco / 100).toFixed(2).replace(".", ",") : "",
                )}
              />
            </Campo>
          </div>

          {editar && (
            <SwitchForm
              name="ativo"
              padrao={servico.ativo}
              label="Serviço ativo"
              descricao="Desativado, some das opções que a IA oferece."
            />
          )}

          <div className="flex justify-end gap-2">
            <Botao
              type="button"
              variante="secundario"
              onClick={() => setAberto(false)}
            >
              Cancelar
            </Botao>
            <BotaoEnviar enviando="Salvando…">Salvar</BotaoEnviar>
          </div>
        </form>
      </Modal>
    </>
  );
}
