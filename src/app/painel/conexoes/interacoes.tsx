"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { AvisoForm, BotaoEnviar, erroDe, valorDe } from "@/components/form";
import { Icon } from "@/components/icons";
import { useToastEstado } from "@/components/toast";
import { Botao, Campo, Input, Modal, Select } from "@/components/ui";
import { cx } from "@/lib/cx";
import { ESTADO_INICIAL, type EstadoForm } from "@/lib/form";
import {
  conectarCanalAction,
  conectarCanalEmbeddedAction,
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
  const [estadoEmbedded, acaoEmbedded] = useActionState(
    conectarCanalEmbeddedAction,
    ESTADO_INICIAL,
  );
  const [provedor, setProvedor] = useState("meta_cloud");

  // As duas variáveis só chegam ao bundle do navegador se alguém configurou
  // o Embedded Signup no App da Meta. Sem elas o botão de um clique some
  // sozinho e sobra só o formulário manual — nenhuma conta fica sem forma
  // de conectar.
  const appId = process.env.NEXT_PUBLIC_META_APP_ID;
  const configId = process.env.NEXT_PUBLIC_META_CONFIG_ID;
  const embeddedDisponivel = Boolean(appId && configId);
  const [modoManual, setModoManual] = useState(false);
  const usarEmbedded = embeddedDisponivel && !modoManual;
  const estadoAtivo = usarEmbedded ? estadoEmbedded : estado;
  useToastEstado(estadoAtivo);

  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      titulo="Conectar WhatsApp"
      subtitulo="Ligamos ao seu número pela API oficial da Meta ou por uma Evolution API que você já tenha."
      largura="max-w-xl"
    >
      {estadoAtivo.ok ? (
        /*
         * Sucesso fica na tela até o usuário fechar: quando é Evolution, a
         * mensagem traz a URL de webhook que ele precisa colar do outro lado.
         * Fechar sozinho engoliria justamente o passo que falta.
         */
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl bg-emerald-50 p-4 ring-1 ring-emerald-200 ring-inset">
            <Icon name="check" className="mt-0.5 size-4 shrink-0 text-emerald-600" />
            <p className="text-[13px] leading-relaxed break-words text-emerald-800">
              {estadoAtivo.mensagem}
            </p>
          </div>
          <div className="flex justify-end">
            <Botao onClick={aoFechar}>Pronto</Botao>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {noLimite && (
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-800 ring-1 ring-amber-200 ring-inset">
              Você já usou os números inclusos no seu plano. Este número entra
              como conexão extra: {precoExtra}/mês na próxima fatura.
            </p>
          )}

          {usarEmbedded ? (
            <FormularioEmbedded
              appId={appId!}
              configId={configId!}
              estado={estadoEmbedded}
              acao={acaoEmbedded}
              aoFechar={aoFechar}
              aoUsarManual={() => setModoManual(true)}
            />
          ) : (
            <FormularioManual
              acao={acao}
              estado={estado}
              provedor={provedor}
              setProvedor={setProvedor}
              embeddedDisponivel={embeddedDisponivel}
              aoUsarEmbedded={() => setModoManual(false)}
              aoFechar={aoFechar}
            />
          )}
        </div>
      )}
    </Modal>
  );
}

function FormularioManual({
  acao,
  estado,
  provedor,
  setProvedor,
  embeddedDisponivel,
  aoUsarEmbedded,
  aoFechar,
}: {
  acao: (payload: FormData) => void;
  estado: EstadoForm;
  provedor: string;
  setProvedor: (valor: string) => void;
  embeddedDisponivel: boolean;
  aoUsarEmbedded: () => void;
  aoFechar: () => void;
}) {
  return (
        <form action={acao} className="space-y-4">
          <AvisoForm estado={estado} />

          {embeddedDisponivel && (
            <button
              type="button"
              onClick={aoUsarEmbedded}
              className="text-[13px] font-medium text-brand-700 hover:underline"
            >
              ← Prefiro logar com a Meta em vez de colar os dados
            </button>
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
  );
}

/* ---------------------------------------- Conectar via Embedded Signup */

declare global {
  interface Window {
    FB?: {
      init: (parametros: Record<string, unknown>) => void;
      login: (
        retorno: (resposta: { authResponse?: { code?: string } }) => void,
        parametros: Record<string, unknown>,
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

const VERSAO_SDK_FACEBOOK = "v21.0";

/** Injeta o SDK JS da Meta uma única vez por página e resolve quando ele avisar que carregou. */
function carregarSdkFacebook(appId: string): Promise<void> {
  return new Promise((resolve, rejeitar) => {
    if (window.FB) {
      resolve();
      return;
    }

    const anterior = window.fbAsyncInit;
    window.fbAsyncInit = () => {
      anterior?.();
      window.FB?.init({ appId, version: VERSAO_SDK_FACEBOOK, xfbml: false });
      resolve();
    };

    if (document.getElementById("facebook-jssdk")) return;

    const script = document.createElement("script");
    script.id = "facebook-jssdk";
    script.src = "https://connect.facebook.net/pt_BR/sdk.js";
    script.async = true;
    script.defer = true;
    script.onerror = () => rejeitar(new Error("Falha ao carregar o script da Meta"));
    document.body.appendChild(script);
  });
}

type DadosEmbedded = { code?: string; wabaId?: string; phoneNumberId?: string };

/**
 * Login com Facebook para Empresas: o cliente escolhe o número numa janela
 * da própria Meta e a gente só recebe de volta um `code` (pop-up) e o
 * `waba_id`/`phone_number_id` (postMessage) — sem token colado à mão. O
 * `code` vira token de acesso no servidor, nunca aqui.
 */
function FormularioEmbedded({
  appId,
  configId,
  estado,
  acao,
  aoFechar,
  aoUsarManual,
}: {
  appId: string;
  configId: string;
  estado: EstadoForm;
  acao: (payload: FormData) => void;
  aoFechar: () => void;
  aoUsarManual: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [nome, setNome] = useState(() => valorDe(estado, "nome"));
  const [dados, setDados] = useState<DadosEmbedded>({});
  // Referência com o mesmo valor de `dados`: as duas peças (code do pop-up,
  // waba/phone do postMessage) chegam em momentos diferentes e de forma
  // assíncrona, então cada handler precisa enxergar o valor mais recente na
  // hora — não o de quando o handler foi criado — pra saber se já pode
  // submeter sem esperar um efeito reagir à mudança de estado.
  const dadosRef = useRef<DadosEmbedded>({});
  const [aguardando, setAguardando] = useState(false);
  const [avisoLocal, setAvisoLocal] = useState<string | null>(null);

  function acrescentarDados(pedaco: DadosEmbedded) {
    const atualizado = { ...dadosRef.current, ...pedaco };
    dadosRef.current = atualizado;
    setDados(atualizado);
    if (atualizado.code && atualizado.wabaId && atualizado.phoneNumberId) {
      setAguardando(false);
      formRef.current?.requestSubmit();
    }
  }

  useEffect(() => {
    function aoReceberMensagem(evento: MessageEvent) {
      if (
        evento.origin !== "https://www.facebook.com" &&
        evento.origin !== "https://web.facebook.com"
      ) {
        return;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(evento.data);
      } catch {
        return;
      }
      if (
        typeof payload !== "object" ||
        payload === null ||
        (payload as { type?: string }).type !== "WA_EMBEDDED_SIGNUP"
      ) {
        return;
      }

      const corpo = payload as {
        event?: string;
        data?: { waba_id?: string; phone_number_id?: string };
      };

      if (corpo.event === "FINISH" && corpo.data?.waba_id && corpo.data?.phone_number_id) {
        acrescentarDados({
          wabaId: corpo.data.waba_id,
          phoneNumberId: corpo.data.phone_number_id,
        });
      }

      if (corpo.event === "CANCEL" || corpo.event === "ERROR") {
        setAguardando(false);
        setAvisoLocal("Conexão cancelada na janela da Meta.");
      }
    }

    window.addEventListener("message", aoReceberMensagem);
    return () => window.removeEventListener("message", aoReceberMensagem);
  }, []);

  async function conectar() {
    if (!nome.trim()) {
      setAvisoLocal("Dê um apelido para o número antes de conectar.");
      return;
    }

    setAvisoLocal(null);
    setAguardando(true);

    try {
      await carregarSdkFacebook(appId);
    } catch {
      setAguardando(false);
      setAvisoLocal("Não foi possível carregar o login da Meta agora. Tente de novo.");
      return;
    }

    if (!window.FB) {
      setAguardando(false);
      setAvisoLocal("Não foi possível carregar o login da Meta agora. Tente de novo.");
      return;
    }

    window.FB.login(
      (resposta) => {
        const code = resposta.authResponse?.code;
        if (!code) {
          setAguardando(false);
          setAvisoLocal("Login com a Meta cancelado ou sem permissão concedida.");
          return;
        }
        acrescentarDados({ code });
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { feature: "whatsapp_embedded_signup", sessionInfoVersion: 3 },
      },
    );
  }

  return (
    <form ref={formRef} action={acao} className="space-y-4">
      <AvisoForm estado={estado} />

      {avisoLocal && !estado.erro && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-[13.5px] text-rose-700"
        >
          <Icon name="alert" className="mt-px size-4 shrink-0" />
          <span>{avisoLocal}</span>
        </div>
      )}

      <Campo
        label="Apelido do número"
        dica="Só para você se achar no painel."
        obrigatorio
        erro={erroDe(estado, "nome")}
      >
        <Input
          name="nome"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Ex: Recepção"
          disabled={aguardando}
          required
        />
      </Campo>

      <input type="hidden" name="code" value={dados.code ?? ""} />
      <input type="hidden" name="wabaId" value={dados.wabaId ?? ""} />
      <input type="hidden" name="phoneNumberId" value={dados.phoneNumberId ?? ""} />

      <p className="text-[13px] leading-relaxed text-ink-500">
        Você loga com a conta do WhatsApp Business da empresa numa janela da
        Meta e escolhe o número por lá — não precisa colar token nem procurar
        o Phone Number ID.
      </p>

      <div className="flex items-center justify-between gap-2 pt-1">
        <button
          type="button"
          onClick={aoUsarManual}
          disabled={aguardando}
          className="text-[13px] font-medium text-ink-500 hover:text-ink-700 hover:underline disabled:opacity-50"
        >
          Prefiro colar os dados manualmente
        </button>
        <div className="flex gap-2">
          <Botao type="button" variante="secundario" onClick={aoFechar} disabled={aguardando}>
            Cancelar
          </Botao>
          <BotaoConectarEmbedded aguardando={aguardando} onClick={conectar} />
        </div>
      </div>
    </form>
  );
}

function BotaoConectarEmbedded({
  aguardando,
  onClick,
}: {
  aguardando: boolean;
  onClick: () => void;
}) {
  // `pending` cobre a ida e volta com o servidor (troca de code por token,
  // verificação da credencial); `aguardando` cobre a etapa antes disso, o
  // tempo que o pop-up da Meta fica aberto — nenhuma delas sozinha conta a
  // história toda.
  const { pending } = useFormStatus();
  const carregando = aguardando || pending;

  return (
    <Botao
      type="button"
      variante="zap"
      icone="whatsapp"
      onClick={onClick}
      disabled={carregando}
    >
      {carregando ? "Conectando…" : "Conectar com um clique"}
    </Botao>
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
  useToastEstado(testado);
  useToastEstado(promovido);
  useToastEstado(renomeado);
  useToastEstado(desconectado);

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
