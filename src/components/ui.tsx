"use client";

import {
  useEffect,
  type ButtonHTMLAttributes,
  type ComponentPropsWithRef,
  type ReactNode,
} from "react";
import { Icon, type IconName } from "./icons";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

/* ---------------------------------------------------------------- Button */

type Variante = "primario" | "secundario" | "fantasma" | "perigo" | "zap";
type Tamanho = "sm" | "md" | "lg";

const VARIANTES: Record<Variante, string> = {
  primario:
    "bg-brand-700 text-white hover:bg-brand-800 shadow-sm shadow-brand-700/25",
  secundario:
    "bg-white text-ink-800 border border-ink-200 hover:bg-ink-50 hover:border-ink-300",
  fantasma: "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
  perigo: "bg-rose-600 text-white hover:bg-rose-700",
  zap: "bg-zap text-white hover:bg-zap-dark shadow-sm shadow-zap/30",
};

const TAMANHOS: Record<Tamanho, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-lg",
  md: "h-10 px-4 text-sm gap-2 rounded-xl",
  lg: "h-12 px-6 text-[15px] gap-2 rounded-xl",
};

export function Botao({
  variante = "primario",
  tamanho = "md",
  icone,
  iconeDireita,
  className,
  children,
  ...rest
}: {
  variante?: Variante;
  tamanho?: Tamanho;
  icone?: IconName;
  iconeDireita?: IconName;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center font-medium transition-all",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
        "disabled:opacity-45 disabled:pointer-events-none active:scale-[0.98]",
        VARIANTES[variante],
        TAMANHOS[tamanho],
        className,
      )}
      {...rest}
    >
      {icone && <Icon name={icone} className="size-4 shrink-0" />}
      {children}
      {iconeDireita && <Icon name={iconeDireita} className="size-4 shrink-0" />}
    </button>
  );
}

/* ------------------------------------------------------------------ Card */

export function Card({
  className,
  children,
  ...rest
}: { children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(
        "rounded-2xl border border-ink-200 bg-white shadow-[0_1px_2px_rgb(15_23_42/0.04)]",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardTitulo({
  titulo,
  subtitulo,
  acao,
  className,
}: {
  titulo: string;
  subtitulo?: string;
  acao?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex items-start justify-between gap-4 border-b border-ink-100 px-5 py-4",
        className,
      )}
    >
      <div>
        <h3 className="text-[15px] font-semibold text-ink-900">{titulo}</h3>
        {subtitulo && (
          <p className="mt-0.5 text-[13px] text-ink-500">{subtitulo}</p>
        )}
      </div>
      {acao}
    </div>
  );
}

/* ----------------------------------------------------------------- Badge */

type TomBadge =
  | "neutro"
  | "marca"
  | "sucesso"
  | "aviso"
  | "perigo"
  | "info"
  | "zap";

const TONS_BADGE: Record<TomBadge, string> = {
  neutro: "bg-ink-100 text-ink-600 ring-ink-200",
  marca: "bg-brand-50 text-brand-700 ring-brand-200",
  sucesso: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  aviso: "bg-amber-50 text-amber-700 ring-amber-200",
  perigo: "bg-rose-50 text-rose-700 ring-rose-200",
  info: "bg-sky-50 text-sky-700 ring-sky-200",
  zap: "bg-[#e7f9ee] text-zap-dark ring-[#b6ecca]",
};

export function Badge({
  tom = "neutro",
  children,
  icone,
  className,
}: {
  tom?: TomBadge;
  children: ReactNode;
  icone?: IconName;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        TONS_BADGE[tom],
        className,
      )}
    >
      {icone && <Icon name={icone} className="size-3" />}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------ Formulário */

export function Campo({
  label,
  dica,
  erro,
  obrigatorio,
  children,
}: {
  label?: string;
  dica?: string;
  erro?: string;
  obrigatorio?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      {label && (
        <span className="mb-1.5 block text-[13px] font-medium text-ink-700">
          {label}
          {obrigatorio && <span className="text-rose-500"> *</span>}
        </span>
      )}
      {children}
      {dica && !erro && <span className="mt-1 block text-xs text-ink-400">{dica}</span>}
      {erro && <span className="mt-1 block text-xs text-rose-600">{erro}</span>}
    </label>
  );
}

const CAMPO_BASE =
  "w-full rounded-xl border border-ink-200 bg-white px-3.5 text-sm text-ink-900 placeholder:text-ink-400 transition-colors focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/10 disabled:bg-ink-50 disabled:text-ink-400";

export function Input({
  className,
  ...rest
}: ComponentPropsWithRef<"input">) {
  return <input className={cx(CAMPO_BASE, "h-11", className)} {...rest} />;
}

export function Textarea({
  className,
  ...rest
}: ComponentPropsWithRef<"textarea">) {
  return (
    <textarea className={cx(CAMPO_BASE, "py-2.5 leading-relaxed", className)} {...rest} />
  );
}

export function Select({
  className,
  children,
  ...rest
}: ComponentPropsWithRef<"select">) {
  return (
    <select
      className={cx(
        CAMPO_BASE,
        "h-11 cursor-pointer appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2364748b%22 stroke-width=%222%22 stroke-linecap=%22round%22><path d=%22m5 9 7 7 7-7%22/></svg>')] bg-[length:16px] bg-[right_0.85rem_center] bg-no-repeat pr-10",
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Switch({
  ativo,
  onChange,
  label,
  descricao,
  disabled,
}: {
  ativo: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  descricao?: string;
  disabled?: boolean;
}) {
  const botao = (
    <button
      type="button"
      role="switch"
      aria-checked={ativo}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!ativo)}
      className={cx(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
        ativo ? "bg-brand-600" : "bg-ink-300",
      )}
    >
      <span
        className={cx(
          "absolute top-0.5 size-5 rounded-full bg-white shadow transition-all",
          ativo ? "left-[22px]" : "left-0.5",
        )}
      />
    </button>
  );
  if (!label && !descricao) return botao;
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        {label && (
          <p className="text-sm font-medium text-ink-800">{label}</p>
        )}
        {descricao && (
          <p className="mt-0.5 text-[13px] text-ink-500">{descricao}</p>
        )}
      </div>
      {botao}
    </div>
  );
}

/* ----------------------------------------------------------------- Modal */

export function Modal({
  aberto,
  aoFechar,
  titulo,
  subtitulo,
  children,
  rodape,
  largura = "max-w-lg",
}: {
  aberto: boolean;
  aoFechar: () => void;
  titulo: string;
  subtitulo?: string;
  children: ReactNode;
  rodape?: ReactNode;
  largura?: string;
}) {
  useEffect(() => {
    if (!aberto) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && aoFechar();
    document.addEventListener("keydown", h);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", h);
      document.body.style.overflow = "";
    };
  }, [aberto, aoFechar]);

  if (!aberto) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-ink-950/40 backdrop-blur-[2px]"
        onClick={aoFechar}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className={cx(
          "relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl animate-fade-up sm:rounded-2xl",
          largura,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-ink-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-ink-900">{titulo}</h2>
            {subtitulo && (
              <p className="mt-0.5 text-[13px] text-ink-500">{subtitulo}</p>
            )}
          </div>
          <button
            onClick={aoFechar}
            aria-label="Fechar"
            className="-mr-1 rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
          >
            <Icon name="x" className="size-4" />
          </button>
        </div>
        <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>
        {rodape && (
          <div className="flex items-center justify-end gap-2 border-t border-ink-100 bg-ink-50/60 px-5 py-3.5">
            {rodape}
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- Progress */

export function Barra({
  valor,
  tom = "marca",
  className,
}: {
  valor: number;
  tom?: "marca" | "sucesso" | "aviso" | "perigo";
  className?: string;
}) {
  const cores = {
    marca: "bg-brand-600",
    sucesso: "bg-emerald-500",
    aviso: "bg-amber-500",
    perigo: "bg-rose-500",
  };
  return (
    <div className={cx("h-2 w-full overflow-hidden rounded-full bg-ink-100", className)}>
      <div
        className={cx("h-full rounded-full transition-all duration-500", cores[tom])}
        style={{ width: `${Math.min(100, Math.max(0, valor))}%` }}
      />
    </div>
  );
}

/* ------------------------------------------------------------ Estat / KPI */

export function Estatistica({
  rotulo,
  valor,
  detalhe,
  icone,
  tom = "marca",
  className,
}: {
  rotulo: string;
  valor: string;
  detalhe?: ReactNode;
  icone: IconName;
  tom?: "marca" | "sucesso" | "aviso" | "perigo" | "info";
  className?: string;
}) {
  const cores = {
    marca: "bg-brand-50 text-brand-700",
    sucesso: "bg-emerald-50 text-emerald-600",
    aviso: "bg-amber-50 text-amber-600",
    perigo: "bg-rose-50 text-rose-600",
    info: "bg-sky-50 text-sky-600",
  };
  return (
    <Card className={cx("p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-ink-500">{rotulo}</p>
        <span className={cx("rounded-lg p-1.5", cores[tom])}>
          <Icon name={icone} className="size-4" />
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-ink-900">
        {valor}
      </p>
      {detalhe && <div className="mt-1 text-[13px] text-ink-500">{detalhe}</div>}
    </Card>
  );
}

/* ------------------------------------------------------------ Empty state */

export function Vazio({
  icone,
  titulo,
  descricao,
  acao,
}: {
  icone: IconName;
  titulo: string;
  descricao: string;
  acao?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <span className="rounded-2xl bg-ink-100 p-3 text-ink-400">
        <Icon name={icone} className="size-6" />
      </span>
      <h3 className="mt-3 text-[15px] font-semibold text-ink-800">{titulo}</h3>
      <p className="mt-1 max-w-sm text-sm text-ink-500">{descricao}</p>
      {acao && <div className="mt-4">{acao}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------- Avatar */

export function Avatar({
  nome,
  cor,
  className = "size-9",
}: {
  nome: string;
  cor: string;
  className?: string;
}) {
  const ini = nome
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full text-xs font-semibold",
        cor,
        className,
      )}
    >
      {ini}
    </span>
  );
}

/* ------------------------------------------------------------------ Tabs */

export function Abas<T extends string>({
  abas,
  ativa,
  aoMudar,
}: {
  abas: { id: T; nome: string; contagem?: number }[];
  ativa: T;
  aoMudar: (id: T) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-xl bg-ink-100 p-1">
      {abas.map((a) => (
        <button
          key={a.id}
          onClick={() => aoMudar(a.id)}
          className={cx(
            "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all",
            ativa === a.id
              ? "bg-white text-ink-900 shadow-sm"
              : "text-ink-500 hover:text-ink-800",
          )}
        >
          {a.nome}
          {a.contagem !== undefined && (
            <span
              className={cx(
                "rounded-full px-1.5 text-[11px]",
                ativa === a.id
                  ? "bg-brand-100 text-brand-700"
                  : "bg-ink-200 text-ink-600",
              )}
            >
              {a.contagem}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- Toasts */

export function Toasts({
  toasts,
  aoFechar,
}: {
  toasts: { id: string; texto: string; tipo: "sucesso" | "info" | "erro" }[];
  aoFechar: (id: string) => void;
}) {
  const estilo = {
    sucesso: "bg-ink-900 text-white",
    info: "bg-brand-700 text-white",
    erro: "bg-rose-600 text-white",
  };
  const icone: Record<string, IconName> = {
    sucesso: "check",
    info: "spark",
    erro: "alert",
  };
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx(
            "pointer-events-auto flex items-center gap-2.5 rounded-xl px-4 py-3 text-sm shadow-lg animate-fade-up",
            estilo[t.tipo],
          )}
        >
          <Icon name={icone[t.tipo]} className="size-4 shrink-0" />
          <span className="flex-1">{t.texto}</span>
          <button
            onClick={() => aoFechar(t.id)}
            aria-label="Fechar aviso"
            className="opacity-60 hover:opacity-100"
          >
            <Icon name="x" className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
