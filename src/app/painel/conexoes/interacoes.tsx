"use client";

import { useActionState, useState } from "react";

import { AvisoForm, BotaoEnviar, erroDe, valorDe } from "@/components/form";
import { Icon } from "@/components/icons";
import { Botao, Campo, Input, Modal, Select } from "@/components/ui";
import { cx } from "@/lib/cx";
import { ESTADO_INICIAL, type EstadoForm } from "@/lib/form";
import {
  conectarCanalAction,
  definirPrincipalAction,
  desconectarCanalAction,
  renomearCanalAction,
  testarConexaoAction,
} from "@/server/actions/conexoes";

/**
 * As partes de Conexões que precisam de browser: modais e menus.
 *
 * A lista em si é Server Component (`page.tsx`). Aqui não existe estado de
 * negócio nenhum — só "modal aberto" e o que a Server Action devolveu. Depois
 * de cada ação o `refresh()` do servidor repinta os cards, então nada é
 * duplicado no client.
 *
 * O protótipo simulava um QR code com `Math.random()` e "conectava" sozinho
 * depois de 1,5s. Conectar de verdade é entregar credencial de provedor: a
 * ação testa contra a Meta/Evolution e só grava se a credencial responder.
 */

/* ------------------------------------------------------- Conectar número */

export function BotaoConectar({
  precoExtra,
  noLimite,
  variante = "primario",
  rotulo = "Conectar novo número",
}: {
  precoExtra: string;
  noLimite: boolean;
  variante?: "primario" | "zap";
  rotulo?: string;
}) {
  const [aberto, setAberto] = useState(false);

  return (
    <>
      <Botao icone="plus" variante={variante} onClick={() => setAberto(true)}>
        {rotulo}
      </Botao>
      <ModalConectar
        aberto={aberto}
        aoFechar={() => setAberto(false)}
        precoExtra={precoExtra}
        noLimite={noLimite}
      />
    </>
  );
}

function ModalConectar({
  aberto,
  aoFechar,
  precoExtra,
  noLimite,
}: {
  aberto: boolean;
  aoFechar: () => void;
  precoExtra: string;
  noLimite: boolean;
}) {
  const [estado, acao] = useActionState(conectarCanalAction, ESTADO_INICIAL);
  const [provedor, setProvedor] = useState("meta_cloud");

  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      titulo="Conectar WhatsApp"
      subtitulo="Ligamos ao seu número pela API oficial da Meta ou por uma Evolution API que você já tenha."
      largura="max-w-xl"
    >
      {estado.ok ? (
        /*
         * Sucesso fica na tela até o usuário fechar: quando é Evolution, a
         * mensagem traz a URL de webhook que ele precisa colar do outro lado.
         * Fechar sozinho engoliria justamente o passo que falta.
         */
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl bg-emerald-50 p-4 ring-1 ring-emerald-200 ring-inset">
            <Icon name="check" className="mt-0.5 size-4 shrink-0 text-emerald-600" />
            <p className="text-[13px] leading-relaxed break-words text-emerald-800">
              {estado.mensagem}
            </p>
          </div>
          <div className="flex justify-end">
            <Botao onClick={aoFechar}>Pronto</Botao>
          </div>
        </div>
      ) : (
        <form action={acao} className="space-y-4">
          <AvisoForm estado={estado} />

          {noLimite && (
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-800 ring-1 ring-amber-200 ring-inset">
              Você já usou os números inclusos no seu plano. Este número entra
              como conexão extra: {precoExtra}/mês na próxima fatura.
            </p>
          )}

          <Campo label="Como conectar" obrigatorio>
            <Select
              name="provedor"
              value={provedor}
              onChange={(e) => setProvedor(e.target.value)}
            >
              <option value="meta_cloud">API oficial do WhatsApp (Meta)</option>
              <option value="evolution">Evolution API (self-hosted)</option>
            </Select>
          </Campo>

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo
              label="Apelido do número"
              dica="Só para você se achar no painel."
              obrigatorio
              erro={erroDe(estado, "nome")}
            >
              <Input
                name="nome"
                placeholder="Ex: Recepção"
                defaultValue={valorDe(estado, "nome")}
                required
              />
            </Campo>
            <Campo
              label="Número com DDD"
              obrigatorio
              erro={erroDe(estado, "numero")}
            >
              <Input
                name="numero"
                inputMode="tel"
                placeholder="(11) 98888-7777"
                defaultValue={valorDe(estado, "numero")}
                required
              />
            </Campo>
          </div>

          {provedor === "meta_cloud" ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo
                  label="Phone Number ID"
                  obrigatorio
                  erro={erroDe(estado, "phoneNumberId")}
                >
                  <Input
                    name="phoneNumberId"
                    placeholder="1029384756..."
                    defaultValue={valorDe(estado, "phoneNumberId")}
                    required
                  />
                </Campo>
                <Campo
                  label="WhatsApp Business Account ID"
                  obrigatorio
                  erro={erroDe(estado, "wabaId")}
                >
                  <Input
                    name="wabaId"
                    placeholder="5647382910..."
                    defaultValue={valorDe(estado, "wabaId")}
                    required
                  />
                </Campo>
              </div>
              <Campo
                label="Token de acesso"
                dica="Meta Business → WhatsApp → Configuração da API. Guardamos criptografado."
                obrigatorio
                erro={erroDe(estado, "token")}
              >
                <Input
                  name="token"
                  placeholder="EAAG..."
                  defaultValue={valorDe(estado, "token")}
                  required
                />
              </Campo>
            </>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo
                  label="URL da API"
                  obrigatorio
                  erro={erroDe(estado, "baseUrl")}
                >
                  <Input
                    name="baseUrl"
                    type="url"
                    placeholder="https://evo.suaempresa.com.br"
                    defaultValue={valorDe(estado, "baseUrl")}
                    required
                  />
                </Campo>
                <Campo
                  label="Instância"
                  obrigatorio
                  erro={erroDe(estado, "instancia")}
                >
                  <Input
                    name="instancia"
                    placeholder="recepcao"
                    defaultValue={valorDe(estado, "instancia")}
                    required
                  />
                </Campo>
              </div>
              <Campo
                label="API key da instância"
                obrigatorio
                erro={erroDe(estado, "token")}
              >
                <Input
                  name="token"
                  defaultValue={valorDe(estado, "token")}
                  required
                />
              </Campo>
            </>
          )}

          <p className="text-[13px] leading-relaxed text-ink-500">
            Testamos a credencial antes de salvar — se o número não responder,
            nada é gravado e ninguém fica com uma conexão morta no painel.
          </p>

          <div className="flex justify-end gap-2 pt-1">
            <Botao type="button" variante="secundario" onClick={aoFechar}>
              Cancelar
            </Botao>
            <BotaoEnviar icone="plug" enviando="Testando credencial…">
              Conectar número
            </BotaoEnviar>
          </div>
        </form>
      )}
    </Modal>
  );
}

/* --------------------------------------------------- Ações de uma conexão */

export function AcoesConexao({
  canalId,
  nome,
  principal,
}: {
  canalId: string;
  nome: string;
  principal: boolean;
}) {
  const [menu, setMenu] = useState(false);
  const [renomeando, setRenomeando] = useState(false);
  const [desconectando, setDesconectando] = useState(false);

  const [testado, testar] = useActionState(testarConexaoAction, ESTADO_INICIAL);
  const [promovido, promover] = useActionState(
    definirPrincipalAction,
    ESTADO_INICIAL,
  );
  const [renomeado, renomear] = useActionState(
    renomearCanalAction,
    ESTADO_INICIAL,
  );
  const [desconectado, desconectar] = useActionState(
    desconectarCanalAction,
    ESTADO_INICIAL,
  );

  const fecharMenu = () => setMenu(false);

  return (
    <>
      {/*
       * Posicionado pelo card (que é `relative`): assim a lista de cards é
       * markup de servidor puro, e o único pedaço de client é este botão.
       */}
      <div className="absolute top-4 right-4">
        <button
          onClick={() => setMenu((m) => !m)}
          aria-label={`Ações de ${nome}`}
          className="rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
        >
          <Icon name="menu" className="size-4" />
        </button>

        {menu && (
          <>
            {/* Camada de clique-fora: barata e não rouba foco do teclado. */}
            <div className="fixed inset-0 z-10" onClick={fecharMenu} />
            <div className="absolute top-9 right-0 z-20 w-56 overflow-hidden rounded-xl border border-ink-200 bg-white py-1 shadow-lg">
              <form action={testar} onSubmit={fecharMenu}>
                <input type="hidden" name="canalId" value={canalId} />
                <ItemMenu icone="refresh">Testar conexão</ItemMenu>
              </form>

              {!principal && (
                <form action={promover} onSubmit={fecharMenu}>
                  <input type="hidden" name="canalId" value={canalId} />
                  <ItemMenu icone="check">Tornar principal</ItemMenu>
                </form>
              )}

              <button
                onClick={() => {
                  fecharMenu();
                  setRenomeando(true);
                }}
                className={ITEM_MENU}
              >
                <Icon name="edit" className="size-4 text-ink-400" />
                Renomear
              </button>

              <div className="my-1 border-t border-ink-100" />

              <button
                onClick={() => {
                  fecharMenu();
                  setDesconectando(true);
                }}
                className={cx(ITEM_MENU, "text-rose-600 hover:bg-rose-50")}
              >
                <Icon name="trash" className="size-4" />
                Desconectar
              </button>
            </div>
          </>
        )}
      </div>

      {/*
       * Retorno das ações rápidas aparece no próprio card. Testar conexão é o
       * caso que mais importa: o cliente aperta justamente porque desconfia
       * que o número parou, e precisa ler o motivo sem sair da tela.
       */}
      <Retorno estado={testado} />
      <Retorno estado={promovido} />
      <Retorno estado={renomeado} />
      <Retorno estado={desconectado} />

      <Modal
        aberto={renomeando}
        aoFechar={() => setRenomeando(false)}
        titulo="Renomear número"
        subtitulo="O apelido aparece no painel e nos relatórios de uso."
      >
        <form action={renomear} className="space-y-4">
          <input type="hidden" name="canalId" value={canalId} />
          <AvisoForm estado={renomeado} />
          <Campo label="Apelido" obrigatorio erro={erroDe(renomeado, "nome")}>
            <Input
              name="nome"
              defaultValue={valorDe(renomeado, "nome", nome)}
              required
              autoFocus
            />
          </Campo>
          <div className="flex justify-end gap-2">
            <Botao
              type="button"
              variante="secundario"
              onClick={() => setRenomeando(false)}
            >
              Cancelar
            </Botao>
            <BotaoEnviar enviando="Salvando…">Salvar</BotaoEnviar>
          </div>
        </form>
      </Modal>

      <Modal
        aberto={desconectando}
        aoFechar={() => setDesconectando(false)}
        titulo="Desconectar número"
        subtitulo={nome}
      >
        <form action={desconectar} className="space-y-4">
          <input type="hidden" name="canalId" value={canalId} />
          <AvisoForm estado={desconectado} />
          <p className="text-sm leading-relaxed text-ink-600">
            A IA para de atender, cobrar e agendar por este número na hora. O
            histórico de conversas continua aqui, e a vaga volta para o seu
            plano — você pode reconectar depois.
          </p>
          <div className="flex justify-end gap-2">
            <Botao
              type="button"
              variante="secundario"
              onClick={() => setDesconectando(false)}
            >
              Manter conectado
            </Botao>
            <BotaoEnviar variante="perigo" enviando="Desconectando…">
              Desconectar
            </BotaoEnviar>
          </div>
        </form>
      </Modal>
    </>
  );
}

const ITEM_MENU =
  "flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-ink-700 transition-colors hover:bg-ink-50";

/** Item de menu que envia o form em que está — daí o `type="submit"`. */
function ItemMenu({
  icone,
  children,
}: {
  icone: "refresh" | "check";
  children: string;
}) {
  return (
    <button type="submit" className={ITEM_MENU}>
      <Icon name={icone} className="size-4 text-ink-400" />
      {children}
    </button>
  );
}

function Retorno({ estado }: { estado: EstadoForm }) {
  const texto = estado.erro ?? (estado.ok ? estado.mensagem : undefined);
  if (!texto) return null;

  return (
    <p
      role="status"
      className={cx(
        "mt-3 rounded-lg px-3 py-2 text-[13px] leading-relaxed",
        estado.erro ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700",
      )}
    >
      {texto}
    </p>
  );
}
