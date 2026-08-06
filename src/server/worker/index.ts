import "server-only";

import { fecharConexoes } from "../db";
import { canalReal } from "../canais/fabrica";
import { limparAntigos } from "../seguranca/limite";
import { processarLote, recuperarTravados, type ResultadoLote } from "./disparos";
import {
  limparEventosAntigos,
  limparSessoesExpiradas,
  reprocessarEventos,
} from "./recuperacao";

/**
 * Processo do worker.
 *
 * Um relógio só, tarefas com períodos diferentes. Nada de `setInterval` por
 * tarefa: com intervalo fixo, uma rodada lenta empilha em cima da anterior e o
 * banco leva duas cargas ao mesmo tempo. Aqui cada tarefa só reagenda depois de
 * terminar.
 *
 * Escala horizontal está garantida na camada de baixo (FOR UPDATE SKIP LOCKED
 * na reserva do disparo e do evento), então subir N réplicas deste processo é
 * seguro e não precisa de eleição de líder.
 *
 * Sobe com `node --env-file=.env dist/worker.js` ou `npm run worker`.
 */

const SEGUNDO = 1000;
const MINUTO = 60 * SEGUNDO;

interface Tarefa {
  nome: string;
  /** Intervalo entre o fim de uma execução e o início da próxima. */
  periodoMs: number;
  /** Só loga quando devolve algo — evita 1 linha por segundo em fila vazia. */
  rodar: () => Promise<unknown>;
  proximaEm: number;
  falhasSeguidas: number;
}

/** Backoff quando a tarefa quebra: banco fora do ar não merece 1 req/s. */
function esperaComBackoff(t: Tarefa): number {
  if (t.falhasSeguidas === 0) return t.periodoMs;
  const fator = Math.min(2 ** t.falhasSeguidas, 30);
  return Math.min(t.periodoMs * fator, 5 * MINUTO);
}

/**
 * Drena a fila enquanto os lotes vierem cheios: um pico de 500 cobranças
 * vencendo às 9h sai em segundos, não em minutos. O teto por rodada evita
 * segurar o loop para sempre quando a fila é maior que a capacidade.
 */
async function cicloDeDisparos(maxLotes = 8): Promise<ResultadoLote> {
  const canal = canalReal();
  const total: ResultadoLote = {
    reservados: 0,
    enviados: 0,
    ignorados: 0,
    falhas: 0,
    detalhes: [],
  };

  for (let i = 0; i < maxLotes; i++) {
    const r = await processarLote(canal);
    total.reservados += r.reservados;
    total.enviados += r.enviados;
    total.ignorados += r.ignorados;
    total.falhas += r.falhas;
    total.detalhes.push(...r.detalhes);
    if (r.reservados === 0) break;
  }

  return total;
}

function interessante(valor: unknown): boolean {
  if (typeof valor === "number") return valor > 0;
  if (valor && typeof valor === "object") {
    return Object.values(valor as Record<string, unknown>).some(
      (v) => typeof v === "number" && v > 0,
    );
  }
  return valor != null;
}

function resumo(valor: unknown): string {
  if (typeof valor === "number") return String(valor);
  if (valor && typeof valor === "object") {
    const o = valor as Record<string, unknown>;
    return Object.entries(o)
      .filter(([, v]) => typeof v === "number" || typeof v === "string")
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(" ");
  }
  return String(valor);
}

function tarefas(): Tarefa[] {
  const agora = Date.now();
  const nova = (nome: string, periodoMs: number, rodar: () => Promise<unknown>): Tarefa => ({
    nome,
    periodoMs,
    rodar,
    proximaEm: agora,
    falhasSeguidas: 0,
  });

  return [
    // O coração: fila de mensagens.
    nova("disparos", 5 * SEGUNDO, () => cicloDeDisparos()),
    // Reserva órfã de um deploy no meio do lote volta para 'agendado'.
    nova("travados", MINUTO, () => recuperarTravados()),
    // Webhook que chegou e não processou.
    nova("eventos", MINUTO, () => reprocessarEventos()),
    // Higiene: nada disso é urgente, mas ninguém faz se o worker não fizer.
    nova("limpeza:rate-limit", 10 * MINUTO, () => limparAntigos()),
    nova("limpeza:sessoes", 6 * 60 * MINUTO, () => limparSessoesExpiradas()),
    nova("limpeza:eventos", 6 * 60 * MINUTO, () => limparEventosAntigos()),
  ];
}

let parando = false;
let emExecucao: Promise<unknown> = Promise.resolve();

function dormir(ms: number): Promise<void> {
  return new Promise((ok) => {
    const t = setTimeout(ok, ms);
    // Timer pendente não pode segurar o processo no shutdown.
    t.unref?.();
  });
}

async function rodarUma(t: Tarefa): Promise<void> {
  const inicio = Date.now();
  try {
    const r = await t.rodar();
    t.falhasSeguidas = 0;
    if (interessante(r)) {
      console.log(`[worker] ${t.nome} ${resumo(r)} (${Date.now() - inicio}ms)`);
    }
  } catch (erro) {
    t.falhasSeguidas++;
    console.error(`[worker] ${t.nome} falhou (${t.falhasSeguidas}x)`, erro);
  } finally {
    t.proximaEm = Date.now() + esperaComBackoff(t);
  }
}

/**
 * Loop principal. Exportado para o teste conseguir rodar com um sinal de parada
 * em vez de depender de SIGTERM.
 */
export async function loop(): Promise<void> {
  const fila = tarefas();
  console.log(
    `[worker] no ar — ${fila.map((t) => `${t.nome}/${t.periodoMs / SEGUNDO}s`).join(" ")}`,
  );

  while (!parando) {
    const agora = Date.now();
    const pronta = fila
      .filter((t) => t.proximaEm <= agora)
      .sort((a, b) => a.proximaEm - b.proximaEm)[0];

    if (!pronta) {
      const proxima = Math.min(...fila.map((t) => t.proximaEm));
      await dormir(Math.max(50, Math.min(proxima - agora, SEGUNDO)));
      continue;
    }

    // Guardar a promessa deixa o shutdown esperar a tarefa terminar em vez de
    // cortar no meio de um envio.
    emExecucao = rodarUma(pronta);
    await emExecucao;
  }
}

export async function encerrar(motivo: string): Promise<void> {
  if (parando) return;
  parando = true;
  console.log(`[worker] encerrando (${motivo})`);

  // Espera a tarefa corrente. Se ela travar, o orquestrador manda SIGKILL —
  // e os disparos reservados voltam sozinhos pelo 'travados'.
  await emExecucao.catch(() => {});
  await fecharConexoes();
  console.log("[worker] parado");
}

export async function principal(): Promise<void> {
  for (const sinal of ["SIGTERM", "SIGINT"] as const) {
    process.on(sinal, () => {
      void encerrar(sinal).then(() => process.exit(0));
    });
  }

  // Erro não tratado com conexão aberta é pior que reinício: deixa o
  // orquestrador reiniciar com estado limpo.
  process.on("unhandledRejection", (erro) => {
    console.error("[worker] rejeição não tratada", erro);
    void encerrar("unhandledRejection").then(() => process.exit(1));
  });

  await loop();
}
