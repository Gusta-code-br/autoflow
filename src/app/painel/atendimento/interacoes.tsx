"use client";

import { useActionState, useEffect, useRef } from "react";

import { AvisoForm, BotaoEnviar } from "@/components/form";
import { Icon } from "@/components/icons";
import { cx } from "@/lib/cx";
import { ESTADO_INICIAL } from "@/lib/form";
import {
  assumirAction,
  marcarLidaAction,
  responderAction,
} from "@/server/actions/atendimento";

/**
 * O pouco de browser que a caixa de entrada precisa.
 *
 * A lista, a thread e o resumo saem prontos do servidor (`page.tsx`); aqui
 * ficam só as três coisas que dependem de interação: escrever, assumir e zerar
 * o contador de não lidas. Todo estado de negócio continua no banco — nenhum
 * componente daqui guarda mensagem em memória.
 */

/* ------------------------------------------------------------- Responder */

export function Composer({
  conversaId,
  modo,
  janelaAberta,
  optOut,
}: {
  conversaId: string;
  modo: "ia" | "humano";
  janelaAberta: boolean;
  optOut: boolean;
}) {
  const [estado, acao] = useActionState(responderAction, ESTADO_INICIAL);
  const form = useRef<HTMLFormElement>(null);

  // Limpa o campo só quando o envio deu certo: se falhou, o texto continua lá
  // para o operador tentar de novo sem reescrever.
  useEffect(() => {
    if (estado.ok) form.current?.reset();
  }, [estado]);

  if (optOut) {
    return (
      <Barra tom="perigo" icone="lock">
        Este contato pediu para não receber mensagens. Envio bloqueado.
      </Barra>
    );
  }

  /*
   * Fora das 24h a Meta só aceita template aprovado — mandar texto livre daria
   * erro do provedor depois de gastar crédito. Melhor dizer antes, com o
   * caminho pronto: a régua de cobrança é quem tem os templates.
   */
  if (!janelaAberta) {
    return (
      <Barra tom="aviso" icone="clock">
        A janela de 24h fechou. Só dá para reabrir com um template aprovado —
        use uma régua de cobrança ou espere o cliente responder.
      </Barra>
    );
  }

  return (
    <form
      ref={form}
      action={acao}
      className="border-t border-ink-200 bg-white px-4 py-3"
    >
      <input type="hidden" name="conversaId" value={conversaId} />
      <AvisoForm estado={estado} />
      {modo === "ia" && (
        <p className="mb-2 flex items-center gap-1.5 text-[12px] text-ink-500">
          <Icon name="spark" className="size-3.5 text-brand-600" />A IA está
          respondendo. Se você enviar, a conversa passa para você.
        </p>
      )}
      <div className="flex items-end gap-2">
        <textarea
          name="texto"
          rows={1}
          required
          maxLength={4096}
          placeholder="Escreva uma mensagem…"
          aria-label="Mensagem"
          className="scrollbar-thin max-h-32 min-h-[42px] flex-1 resize-y rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 text-[13.5px] text-ink-900 transition-colors placeholder:text-ink-400 focus:border-brand-500 focus:outline-none"
        />
        <BotaoEnviar icone="send" enviando="Enviando…">
          Enviar
        </BotaoEnviar>
      </div>
    </form>
  );
}

function Barra({
  tom,
  icone,
  children,
}: {
  tom: "aviso" | "perigo";
  icone: "clock" | "lock";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cx(
        "flex items-start gap-2 border-t px-4 py-3 text-[13px]",
        tom === "perigo"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-amber-200 bg-amber-50 text-amber-800",
      )}
    >
      <Icon name={icone} className="mt-0.5 size-4 shrink-0" />
      <p className="leading-relaxed">{children}</p>
    </div>
  );
}

/* --------------------------------------------------- Assumir / devolver */

export function BotaoModo({
  conversaId,
  modo,
}: {
  conversaId: string;
  modo: "ia" | "humano";
}) {
  const [, acao] = useActionState(assumirAction, ESTADO_INICIAL);

  return (
    <form action={acao}>
      <input type="hidden" name="conversaId" value={conversaId} />
      <input
        type="hidden"
        name="modo"
        value={modo === "ia" ? "humano" : "ia"}
      />
      <BotaoEnviar
        variante="secundario"
        tamanho="sm"
        icone={modo === "ia" ? "user" : "spark"}
      >
        {modo === "ia" ? "Assumir" : "Devolver pra IA"}
      </BotaoEnviar>
    </form>
  );
}

/* ------------------------------------------------------- Marcar como lida */

/**
 * Efeito colateral sem UI: ao abrir a thread, zera o contador.
 *
 * A action não dá `refresh()` de propósito — repintar a árvore no meio da
 * leitura faria a tela piscar. O badge some na próxima navegação, que é
 * exatamente quando o número volta a importar.
 */
export function MarcarLida({
  conversaId,
  naoLidas,
}: {
  conversaId: string;
  naoLidas: number;
}) {
  useEffect(() => {
    if (naoLidas > 0) void marcarLidaAction(conversaId);
  }, [conversaId, naoLidas]);

  return null;
}
