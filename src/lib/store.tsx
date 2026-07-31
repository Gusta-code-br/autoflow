"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  AGENDAMENTOS_DEMO,
  COBRANCAS_DEMO,
  CONEXOES_DEMO,
  CONTA_DEMO,
  CONTA_NOVA,
  CONVERSAS_DEMO,
  REGUAS_DEMO,
  TRANSACOES_DEMO,
  USO_DEMO,
} from "./mock-data";
import { PACOTES_CREDITO, PRECO_CONEXAO_EXTRA, getPlano, precoTotalCom } from "./plans";
import type {
  Agendamento,
  Cobranca,
  Conexao,
  Conta,
  Conversa,
  FeatureKey,
  PeriodoId,
  PlanId,
  Regua,
  Transacao,
  UsoDiario,
} from "./types";

const CHAVE = "autoflow:estado:v1";

interface Estado {
  logado: boolean;
  conta: Conta;
  cobrancas: Cobranca[];
  reguas: Regua[];
  conversas: Conversa[];
  agendamentos: Agendamento[];
  conexoes: Conexao[];
  transacoes: Transacao[];
  uso: UsoDiario[];
}

function estadoDemo(): Estado {
  return {
    logado: false,
    conta: structuredClone(CONTA_DEMO),
    cobrancas: structuredClone(COBRANCAS_DEMO),
    reguas: structuredClone(REGUAS_DEMO),
    conversas: structuredClone(CONVERSAS_DEMO),
    agendamentos: structuredClone(AGENDAMENTOS_DEMO),
    conexoes: structuredClone(CONEXOES_DEMO),
    transacoes: structuredClone(TRANSACOES_DEMO),
    uso: structuredClone(USO_DEMO),
  };
}

export interface Toast {
  id: string;
  texto: string;
  tipo: "sucesso" | "info" | "erro";
}

interface Ctx extends Estado {
  pronto: boolean;
  // derivados
  creditosTotais: number;
  creditosRestantes: number;
  percentualUso: number;
  conexoesTotais: number;
  tem: (f: FeatureKey) => boolean;
  // sessão
  entrar: () => void;
  sair: () => void;
  comecarCadastro: (email: string, empresa: string) => void;
  resetarDemo: () => void;
  carregarDemo: () => void;
  // conta
  atualizarConta: (patch: Partial<Conta>) => void;
  assinar: (planoId: PlanId, periodo: PeriodoId) => void;
  comprarCreditos: (pacoteId: string) => void;
  // conexões
  adicionarConexao: (nome: string, numero: string) => void;
  removerConexao: (id: string) => void;
  // réguas
  salvarRegua: (regua: Regua) => void;
  removerRegua: (id: string) => void;
  alternarRegua: (id: string) => void;
  // cobranças
  criarCobranca: (c: Omit<Cobranca, "id">) => void;
  marcarPago: (id: string) => void;
  cancelarCobranca: (id: string) => void;
  // conversas
  enviarMensagem: (conversaId: string, texto: string) => void;
  alternarModo: (conversaId: string) => void;
  marcarLida: (conversaId: string) => void;
  // agenda
  mudarStatusAgendamento: (id: string, status: Agendamento["status"]) => void;
  criarAgendamento: (a: Omit<Agendamento, "id">) => void;
  // toasts
  toasts: Toast[];
  notificar: (texto: string, tipo?: Toast["tipo"]) => void;
  fecharToast: (id: string) => void;
}

const AppCtx = createContext<Ctx | null>(null);

function id(prefixo: string) {
  return `${prefixo}_${Math.random().toString(36).slice(2, 9)}`;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<Estado>(estadoDemo);
  const [pronto, setPronto] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Hidratação do localStorage: adiada para depois da renderização inicial,
  // para não divergir do HTML do servidor nem encadear renders no efeito.
  useEffect(() => {
    let vivo = true;
    queueMicrotask(() => {
      if (!vivo) return;
      try {
        const bruto = localStorage.getItem(CHAVE);
        if (bruto) setEstado({ ...estadoDemo(), ...JSON.parse(bruto) });
      } catch {
        /* estado padrão */
      }
      setPronto(true);
    });
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => {
    if (!pronto) return;
    try {
      localStorage.setItem(CHAVE, JSON.stringify(estado));
    } catch {
      /* cota cheia — irrelevante no protótipo */
    }
  }, [estado, pronto]);

  const notificar = useCallback(
    (texto: string, tipo: Toast["tipo"] = "sucesso") => {
      const t = { id: id("t"), texto, tipo };
      setToasts((prev) => [...prev, t]);
      setTimeout(
        () => setToasts((prev) => prev.filter((x) => x.id !== t.id)),
        3800,
      );
    },
    [],
  );

  const fecharToast = useCallback(
    (tid: string) => setToasts((prev) => prev.filter((x) => x.id !== tid)),
    [],
  );

  const patch = useCallback(
    (fn: (e: Estado) => Partial<Estado>) =>
      setEstado((e) => ({ ...e, ...fn(e) })),
    [],
  );

  const valor = useMemo<Ctx>(() => {
    const plano = getPlano(estado.conta.planoId);
    const creditosTotais = plano.creditosMes + estado.conta.creditosExtras;
    const creditosRestantes = Math.max(
      0,
      creditosTotais - estado.conta.creditosUsados,
    );
    const percentualUso = creditosTotais
      ? Math.min(100, Math.round((estado.conta.creditosUsados / creditosTotais) * 100))
      : 0;

    return {
      ...estado,
      pronto,
      toasts,
      notificar,
      fecharToast,
      creditosTotais,
      creditosRestantes,
      percentualUso,
      conexoesTotais:
        plano.conexoesInclusas + estado.conta.conexoesExtras,
      tem: (f) => plano.features.includes(f),

      entrar: () =>
        patch(() => ({
          logado: true,
          conta: { ...structuredClone(CONTA_DEMO) },
        })),

      sair: () => patch(() => ({ logado: false })),

      comecarCadastro: (email, empresa) =>
        setEstado(() => ({
          ...estadoDemo(),
          logado: true,
          conta: {
            ...structuredClone(CONTA_NOVA),
            email,
            nomeEmpresa: empresa,
          },
          cobrancas: [],
          conversas: [],
          agendamentos: [],
          conexoes: [],
          transacoes: [],
          reguas: [],
          uso: [],
        })),

      resetarDemo: () => {
        localStorage.removeItem(CHAVE);
        setEstado(estadoDemo());
        notificar("Protótipo reiniciado.", "info");
      },

      carregarDemo: () => {
        setEstado({ ...estadoDemo(), logado: true });
        notificar("Dados de demonstração carregados.", "info");
      },

      atualizarConta: (p) => patch((e) => ({ conta: { ...e.conta, ...p } })),

      assinar: (planoId, periodo) =>
        patch((e) => {
          const total = precoTotalCom(planoId, periodo);
          const meses = { mensal: 1, semestral: 6, anual: 12 }[periodo];
          const expira = new Date();
          expira.setMonth(expira.getMonth() + meses);
          return {
            conta: {
              ...e.conta,
              planoId,
              periodo,
              assinadoEm: new Date().toISOString(),
              expiraEm: expira.toISOString(),
              onboardingCompleto: true,
            },
            transacoes: [
              {
                id: id("tx"),
                tipo: "assinatura",
                descricao: `Plano ${getPlano(planoId).nome} — ${meses} ${meses === 1 ? "mês" : "meses"}`,
                valor: total,
                data: new Date().toISOString(),
                status: "pago",
                metodo: "pix",
              },
              ...e.transacoes,
            ],
          };
        }),

      comprarCreditos: (pacoteId) =>
        patch((e) => {
          const pac = PACOTES_CREDITO.find((p) => p.id === pacoteId);
          if (!pac) return {};
          return {
            conta: {
              ...e.conta,
              creditosExtras: e.conta.creditosExtras + pac.creditos,
            },
            transacoes: [
              {
                id: id("tx"),
                tipo: "creditos",
                descricao: `Pacote de ${pac.creditos.toLocaleString("pt-BR")} mensagens`,
                valor: pac.preco,
                data: new Date().toISOString(),
                status: "pago",
                metodo: "pix",
              },
              ...e.transacoes,
            ],
          };
        }),

      adicionarConexao: (nome, numero) =>
        patch((e) => {
          const plano2 = getPlano(e.conta.planoId);
          const inclusas = plano2.conexoesInclusas + e.conta.conexoesExtras;
          const precisaPagar = e.conexoes.length >= inclusas;
          return {
            conexoes: [
              ...e.conexoes,
              {
                id: id("wpp"),
                nome,
                numero,
                status: "conectado",
                principal: e.conexoes.length === 0,
                mensagensMes: 0,
                ultimaSync: new Date().toISOString(),
              },
            ],
            conta: precisaPagar
              ? { ...e.conta, conexoesExtras: e.conta.conexoesExtras + 1 }
              : e.conta,
            transacoes: precisaPagar
              ? [
                  {
                    id: id("tx"),
                    tipo: "conexao" as const,
                    descricao: `WhatsApp adicional (${nome})`,
                    valor: PRECO_CONEXAO_EXTRA,
                    data: new Date().toISOString(),
                    status: "pago" as const,
                    metodo: "pix" as const,
                  },
                  ...e.transacoes,
                ]
              : e.transacoes,
          };
        }),

      removerConexao: (cid) =>
        patch((e) => ({ conexoes: e.conexoes.filter((c) => c.id !== cid) })),

      salvarRegua: (regua) =>
        patch((e) => ({
          reguas: e.reguas.some((r) => r.id === regua.id)
            ? e.reguas.map((r) => (r.id === regua.id ? regua : r))
            : [...e.reguas, regua],
        })),

      removerRegua: (rid) =>
        patch((e) => ({ reguas: e.reguas.filter((r) => r.id !== rid) })),

      alternarRegua: (rid) =>
        patch((e) => ({
          reguas: e.reguas.map((r) =>
            r.id === rid ? { ...r, ativa: !r.ativa } : r,
          ),
        })),

      criarCobranca: (c) =>
        patch((e) => ({ cobrancas: [{ ...c, id: id("cob") }, ...e.cobrancas] })),

      marcarPago: (cid) =>
        patch((e) => ({
          cobrancas: e.cobrancas.map((c) =>
            c.id === cid
              ? { ...c, status: "pago", pagoEm: new Date().toISOString() }
              : c,
          ),
        })),

      cancelarCobranca: (cid) =>
        patch((e) => ({
          cobrancas: e.cobrancas.map((c) =>
            c.id === cid ? { ...c, status: "cancelado" } : c,
          ),
        })),

      enviarMensagem: (conversaId, texto) =>
        patch((e) => ({
          conversas: e.conversas.map((c) =>
            c.id === conversaId
              ? {
                  ...c,
                  ultimaAtividade: new Date().toISOString(),
                  naoLidas: 0,
                  mensagens: [
                    ...c.mensagens,
                    {
                      id: id("m"),
                      autor: "humano" as const,
                      texto,
                      hora: new Date().toISOString(),
                    },
                  ],
                }
              : c,
          ),
        })),

      alternarModo: (conversaId) =>
        patch((e) => ({
          conversas: e.conversas.map((c) => {
            if (c.id !== conversaId) return c;
            const novoModo = c.modo === "ia" ? "humano" : "ia";
            return {
              ...c,
              modo: novoModo,
              mensagens: [
                ...c.mensagens,
                {
                  id: id("m"),
                  autor: "sistema" as const,
                  texto:
                    novoModo === "humano"
                      ? "Você assumiu a conversa. A IA está pausada neste contato."
                      : "Conversa devolvida para a IA.",
                  hora: new Date().toISOString(),
                },
              ],
            };
          }),
        })),

      marcarLida: (conversaId) =>
        patch((e) => ({
          conversas: e.conversas.map((c) =>
            c.id === conversaId ? { ...c, naoLidas: 0 } : c,
          ),
        })),

      mudarStatusAgendamento: (aid, status) =>
        patch((e) => ({
          agendamentos: e.agendamentos.map((a) =>
            a.id === aid ? { ...a, status } : a,
          ),
        })),

      criarAgendamento: (a) =>
        patch((e) => ({
          agendamentos: [...e.agendamentos, { ...a, id: id("ag") }],
        })),
    };
  }, [estado, pronto, toasts, notificar, fecharToast, patch]);

  return <AppCtx.Provider value={valor}>{children}</AppCtx.Provider>;
}

export function useApp(): Ctx {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error("useApp precisa estar dentro de <AppProvider>");
  return ctx;
}
