"use client";

import { useActionState, useState } from "react";

import { AvisoForm, BotaoEnviar, erroDe, valorDe } from "@/components/form";
import { Icon } from "@/components/icons";
import { useToastEstado } from "@/components/toast";
import { Botao, Campo, Input, Modal, Select, Textarea } from "@/components/ui";
import { cx } from "@/lib/cx";
import { ESTADO_INICIAL, type EstadoForm } from "@/lib/form";
import {
  cancelarCobrancaAction,
  criarCobrancaAction,
  marcarPagoAction,
} from "@/server/actions/cobrancas";
import {
  alternarAtivaAction,
  arquivarReguaAction,
  definirPadraoAction,
  duplicarReguaAction,
} from "@/server/actions/reguas";

/**
 * Os pedaços de Cobrança que precisam de browser.
 *
 * A lista, os totais e os filtros são servidor — o filtro é um `<form method="get">`
 * de verdade, então funciona com o JS ainda carregando e a URL fica
 * compartilhável. Aqui ficam só os modais e o retorno das ações.
 */

/* ---------------------------------------------------------- Nova cobrança */

export function BotaoNovaCobranca({
  reguas,
}: {
  reguas: { id: string; nome: string; padrao: boolean }[];
}) {
  /*
   * O vencimento sugerido nasce no clique, não no render: o relógio é do
   * cliente (que é quem enxerga o campo) e ler a data durante o render deixaria
   * o componente impuro — dois renders no mesmo dia poderiam sugerir dias
   * diferentes.
   */
  const [vencimentoPadrao, setVencimentoPadrao] = useState("");
  const [aberto, setAberto] = useState(false);
  const [estado, acao] = useActionState(criarCobrancaAction, ESTADO_INICIAL);
  useToastEstado(estado);

  const padrao = reguas.find((r) => r.padrao) ?? reguas[0];

  function abrir() {
    const d = new Date(Date.now() + 7 * 864e5);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); // fatia a data local, não UTC
    setVencimentoPadrao(d.toISOString().slice(0, 10));
    setAberto(true);
  }

  return (
    <>
      <Botao icone="plus" onClick={abrir}>
        Nova cobrança
      </Botao>

      <Modal
        aberto={aberto}
        aoFechar={() => setAberto(false)}
        titulo="Nova cobrança"
        subtitulo="A régua assume daqui: lembra antes, cobra no dia e insiste depois."
        largura="max-w-xl"
      >
        {estado.ok ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl bg-emerald-50 p-4 ring-1 ring-emerald-200 ring-inset">
              <Icon name="check" className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              <p className="text-[13px] leading-relaxed text-emerald-800">
                {estado.mensagem}
              </p>
            </div>
            <div className="flex justify-end">
              <Botao onClick={() => setAberto(false)}>Pronto</Botao>
            </div>
          </div>
        ) : (
          <form action={acao} className="space-y-4">
            <AvisoForm estado={estado} />

            <div className="grid gap-4 sm:grid-cols-2">
              <Campo label="Cliente" obrigatorio erro={erroDe(estado, "nome")}>
                <Input
                  name="nome"
                  placeholder="Maria Souza"
                  defaultValue={valorDe(estado, "nome")}
                  required
                  autoFocus
                />
              </Campo>
              <Campo
                label="WhatsApp"
                obrigatorio
                dica="É para onde a cobrança vai. Fora do Brasil? Digite com + e o código do país."
                erro={erroDe(estado, "telefone")}
              >
                <Input
                  name="telefone"
                  inputMode="tel"
                  placeholder="(11) 98888-7777"
                  defaultValue={valorDe(estado, "telefone")}
                  required
                />
              </Campo>
            </div>

            <Campo
              label="Descrição"
              obrigatorio
              dica="O cliente lê isso na mensagem."
              erro={erroDe(estado, "descricao")}
            >
              <Input
                name="descricao"
                placeholder="Mensalidade de março"
                defaultValue={valorDe(estado, "descricao")}
                required
              />
            </Campo>

            <div className="grid gap-4 sm:grid-cols-2">
              <Campo label="Valor" obrigatorio erro={erroDe(estado, "valor")}>
                <Input
                  name="valor"
                  inputMode="decimal"
                  placeholder="1.234,56"
                  defaultValue={valorDe(estado, "valor")}
                  required
                />
              </Campo>
              <Campo
                label="Vencimento"
                obrigatorio
                erro={erroDe(estado, "vencimento")}
              >
                <Input
                  name="vencimento"
                  type="date"
                  defaultValue={valorDe(estado, "vencimento", vencimentoPadrao)}
                  required
                />
              </Campo>
            </div>

            <Campo
              label="Régua"
              dica="A sequência de mensagens que vai atrás deste valor."
            >
              <Select name="reguaId" defaultValue={padrao?.id ?? ""}>
                {reguas.length === 0 && (
                  <option value="">Nenhuma régua ativa</option>
                )}
                {reguas.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.nome}
                    {r.padrao ? " (padrão)" : ""}
                  </option>
                ))}
                <option value="">Sem régua — só registrar</option>
              </Select>
            </Campo>

            <Campo label="Observação interna" dica="Só você vê. O cliente, não.">
              <Textarea
                name="observacao"
                rows={2}
                defaultValue={valorDe(estado, "observacao")}
              />
            </Campo>

            <div className="flex justify-end gap-2 pt-1">
              <Botao
                type="button"
                variante="secundario"
                onClick={() => setAberto(false)}
              >
                Cancelar
              </Botao>
              <BotaoEnviar enviando="Agendando régua…">Criar cobrança</BotaoEnviar>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}

/* ------------------------------------------------- Ações de uma cobrança */

export function AcoesCobranca({
  cobrancaId,
  cliente,
  valor,
  encerrada,
}: {
  cobrancaId: string;
  cliente: string;
  valor: string;
  encerrada: boolean;
}) {
  const [pagando, setPagando] = useState(false);
  const [cancelando, setCancelando] = useState(false);

  const [pago, marcarPago] = useActionState(marcarPagoAction, ESTADO_INICIAL);
  const [cancelado, cancelar] = useActionState(
    cancelarCobrancaAction,
    ESTADO_INICIAL,
  );
  useToastEstado(pago);
  useToastEstado(cancelado);

  if (encerrada) return <Retorno estado={pago} />;

  return (
    <>
      <div className="flex shrink-0 items-center gap-1.5">
        <Botao tamanho="sm" variante="secundario" onClick={() => setPagando(true)}>
          Dar baixa
        </Botao>
        <button
          onClick={() => setCancelando(true)}
          aria-label={`Cancelar cobrança de ${cliente}`}
          className="rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
        >
          <Icon name="x" className="size-4" />
        </button>
      </div>

      <Modal
        aberto={pagando}
        aoFechar={() => setPagando(false)}
        titulo="Registrar pagamento"
        subtitulo={`${cliente} · ${valor}`}
      >
        <form action={marcarPago} className="space-y-4">
          <input type="hidden" name="cobrancaId" value={cobrancaId} />
          <AvisoForm estado={pago} />
          <p className="text-sm leading-relaxed text-ink-600">
            A régua para na hora e o cliente não recebe mais nenhuma mensagem
            sobre esta cobrança.
          </p>
          <Campo
            label="Valor recebido"
            dica="Deixe em branco se recebeu o valor cheio."
          >
            <Input name="valorPago" inputMode="decimal" placeholder={valor} />
          </Campo>
          <div className="flex justify-end gap-2">
            <Botao
              type="button"
              variante="secundario"
              onClick={() => setPagando(false)}
            >
              Voltar
            </Botao>
            <BotaoEnviar enviando="Registrando…">Registrar pagamento</BotaoEnviar>
          </div>
        </form>
      </Modal>

      <Modal
        aberto={cancelando}
        aoFechar={() => setCancelando(false)}
        titulo="Cancelar cobrança"
        subtitulo={`${cliente} · ${valor}`}
      >
        <form action={cancelar} className="space-y-4">
          <input type="hidden" name="cobrancaId" value={cobrancaId} />
          <AvisoForm estado={cancelado} />
          <p className="text-sm leading-relaxed text-ink-600">
            Nenhuma mensagem pendente será enviada. O histórico do que já saiu
            continua no cadastro do cliente.
          </p>
          <Campo label="Motivo" dica="Aparece no histórico da cobrança.">
            <Input name="motivo" placeholder="Ex: cliente renegociou no balcão" />
          </Campo>
          <div className="flex justify-end gap-2">
            <Botao
              type="button"
              variante="secundario"
              onClick={() => setCancelando(false)}
            >
              Manter cobrança
            </Botao>
            <BotaoEnviar variante="perigo" enviando="Cancelando…">
              Cancelar cobrança
            </BotaoEnviar>
          </div>
        </form>
      </Modal>

      <Retorno estado={pago} />
      <Retorno estado={cancelado} />
    </>
  );
}

/* ---------------------------------------------------- Ações de uma régua */

export function AcoesRegua({
  reguaId,
  nome,
  ativa,
  padrao,
  emAndamento,
}: {
  reguaId: string;
  nome: string;
  ativa: boolean;
  padrao: boolean;
  emAndamento: number;
}) {
  const [menu, setMenu] = useState(false);
  const [arquivando, setArquivando] = useState(false);

  const [alternado, alternar] = useActionState(
    alternarAtivaAction,
    ESTADO_INICIAL,
  );
  const [promovido, promover] = useActionState(
    definirPadraoAction,
    ESTADO_INICIAL,
  );
  const [duplicado, duplicar] = useActionState(
    duplicarReguaAction,
    ESTADO_INICIAL,
  );
  const [arquivado, arquivar] = useActionState(
    arquivarReguaAction,
    ESTADO_INICIAL,
  );
  useToastEstado(alternado);
  useToastEstado(promovido);
  useToastEstado(duplicado);
  useToastEstado(arquivado);

  return (
    <>
      <div className="absolute top-4 right-4">
        <button
          onClick={() => setMenu((m) => !m)}
          aria-label={`Ações da régua ${nome}`}
          className="rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
        >
          <Icon name="menu" className="size-4" />
        </button>

        {menu && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
            <div className="absolute top-9 right-0 z-20 w-52 overflow-hidden rounded-xl border border-ink-200 bg-white py-1 shadow-lg">
              <form action={alternar} onSubmit={() => setMenu(false)}>
                <input type="hidden" name="id" value={reguaId} />
                <input type="hidden" name="ativa" value={ativa ? "" : "on"} />
                <button type="submit" className={ITEM}>
                  <Icon
                    name={ativa ? "pause" : "play"}
                    className="size-4 text-ink-400"
                  />
                  {ativa ? "Pausar régua" : "Ativar régua"}
                </button>
              </form>

              {!padrao && (
                <form action={promover} onSubmit={() => setMenu(false)}>
                  <input type="hidden" name="id" value={reguaId} />
                  <button type="submit" className={ITEM}>
                    <Icon name="check" className="size-4 text-ink-400" />
                    Tornar padrão
                  </button>
                </form>
              )}

              <form action={duplicar} onSubmit={() => setMenu(false)}>
                <input type="hidden" name="id" value={reguaId} />
                <button type="submit" className={ITEM}>
                  <Icon name="copy" className="size-4 text-ink-400" />
                  Duplicar
                </button>
              </form>

              <div className="my-1 border-t border-ink-100" />

              <button
                onClick={() => {
                  setMenu(false);
                  setArquivando(true);
                }}
                className={cx(ITEM, "text-rose-600 hover:bg-rose-50")}
              >
                <Icon name="trash" className="size-4" />
                Arquivar
              </button>
            </div>
          </>
        )}
      </div>

      <Retorno estado={alternado} />
      <Retorno estado={promovido} />
      <Retorno estado={duplicado} />
      <Retorno estado={arquivado} />

      <Modal
        aberto={arquivando}
        aoFechar={() => setArquivando(false)}
        titulo="Arquivar régua"
        subtitulo={nome}
      >
        <form action={arquivar} className="space-y-4">
          <input type="hidden" name="id" value={reguaId} />
          <AvisoForm estado={arquivado} />
          <p className="text-sm leading-relaxed text-ink-600">
            {emAndamento > 0 ? (
              <>
                Existem{" "}
                <strong className="font-medium text-ink-900">
                  {emAndamento} cobranças
                </strong>{" "}
                rodando nesta régua. Arquivar cancela as mensagens que ainda não
                saíram — as cobranças continuam em aberto, só param de ser
                perseguidas.
              </>
            ) : (
              "A régua sai da lista e deixa de ser oferecida em novas cobranças."
            )}
          </p>
          <div className="flex justify-end gap-2">
            <Botao
              type="button"
              variante="secundario"
              onClick={() => setArquivando(false)}
            >
              Voltar
            </Botao>
            <BotaoEnviar variante="perigo" enviando="Arquivando…">
              Arquivar régua
            </BotaoEnviar>
          </div>
        </form>
      </Modal>
    </>
  );
}

const ITEM =
  "flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-ink-700 transition-colors hover:bg-ink-50";

function Retorno({ estado }: { estado: EstadoForm }) {
  const texto = estado.erro ?? (estado.ok ? estado.mensagem : undefined);
  if (!texto) return null;

  return (
    <p
      role="status"
      className={cx(
        "mt-3 rounded-lg px-3 py-2 text-[13px] leading-relaxed",
        estado.erro
          ? "bg-rose-50 text-rose-700"
          : "bg-emerald-50 text-emerald-700",
      )}
    >
      {texto}
    </p>
  );
}
