/**
 * Conversão entre "hora de parede" (o que o usuário configurou: "09:00 na minha
 * clínica") e instante absoluto (timestamptz).
 *
 * Regra do projeto: `regua_etapa.hora` é hora LOCAL da organização. Tratar isso
 * com `new Date().setHours()` — como o protótipo faz — usa o fuso do servidor,
 * que na Vercel é UTC. Resultado: cobrança disparada às 6h da manhã.
 *
 * Sem dependência externa: `Intl` já carrega a base de fusos (IANA).
 */

export type DataLocal = string; // 'YYYY-MM-DD'
export type HoraLocal = string; // 'HH:MM'

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const RE_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

// Instanciar Intl.DateTimeFormat é caro; o worker chama isso milhares de vezes.
const cacheFormatadores = new Map<string, Intl.DateTimeFormat>();

function formatador(fuso: string): Intl.DateTimeFormat {
  let f = cacheFormatadores.get(fuso);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: fuso,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "longOffset",
    });
    cacheFormatadores.set(fuso, f);
  }
  return f;
}

export interface PartesLocais {
  ano: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  segundo: number;
  /** Minutos em relação ao UTC. São Paulo = -180. */
  offsetMinutos: number;
  /** 0 = domingo … 6 = sábado, no fuso informado. */
  diaSemana: number;
}

/** Valida o fuso uma vez e devolve erro claro (em vez de RangeError críptico). */
export function fusoValido(fuso: string): boolean {
  try {
    formatador(fuso);
    return true;
  } catch {
    return false;
  }
}

export function partesLocais(instante: Date, fuso: string): PartesLocais {
  const partes = formatador(fuso).formatToParts(instante);
  const get = (tipo: string) =>
    partes.find((p) => p.type === tipo)?.value ?? "";

  // 'GMT-03:00' | 'GMT+05:30' | 'GMT' (para UTC)
  const bruto = get("timeZoneName");
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(bruto);
  const offsetMinutos = m
    ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]))
    : 0;

  // hourCycle h23 pode devolver '24' para meia-noite em algumas ICUs
  const hora = Number(get("hour")) % 24;

  const ano = Number(get("year"));
  const mes = Number(get("month"));
  const dia = Number(get("day"));

  return {
    ano,
    mes,
    dia,
    hora,
    minuto: Number(get("minute")),
    segundo: Number(get("second")),
    offsetMinutos,
    diaSemana: new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay(),
  };
}

/** Offset do fuso, em minutos, naquele instante (varia com horário de verão). */
export function offsetMinutos(fuso: string, instante: Date): number {
  return partesLocais(instante, fuso).offsetMinutos;
}

/** Data local ('YYYY-MM-DD') de um instante, no fuso informado. */
export function dataLocalDe(instante: Date, fuso: string): DataLocal {
  const p = partesLocais(instante, fuso);
  return `${p.ano.toString().padStart(4, "0")}-${p.mes
    .toString()
    .padStart(2, "0")}-${p.dia.toString().padStart(2, "0")}`;
}

/** Hora local ('HH:MM') de um instante, no fuso informado. */
export function horaLocalDe(instante: Date, fuso: string): HoraLocal {
  const p = partesLocais(instante, fuso);
  return `${p.hora.toString().padStart(2, "0")}:${p.minuto
    .toString()
    .padStart(2, "0")}`;
}

/**
 * O inverso: "2026-08-10 09:00 em America/Sao_Paulo" → instante UTC.
 *
 * Precisa de duas passadas porque o offset depende do próprio instante que
 * estamos calculando (galinha e ovo). A primeira passada chuta usando o offset
 * vigente no palpite; se o offset real do resultado for outro (mudança de
 * horário de verão dentro da janela), corrige.
 */
export function instanteDaHoraLocal(
  data: DataLocal,
  hora: HoraLocal,
  fuso: string,
): Date {
  if (!RE_DATA.test(data)) throw new Error(`data local inválida: ${data}`);
  if (!RE_HORA.test(hora)) throw new Error(`hora local inválida: ${hora}`);

  const [ano, mes, dia] = data.split("-").map(Number);
  const [h, min] = hora.split(":").map(Number);

  // Trata a hora de parede como se fosse UTC; depois desconta o offset.
  const comoUtc = Date.UTC(ano, mes - 1, dia, h, min, 0, 0);

  const off1 = offsetMinutos(fuso, new Date(comoUtc));
  let t = comoUtc - off1 * 60_000;

  const off2 = offsetMinutos(fuso, new Date(t));
  if (off2 !== off1) {
    t = comoUtc - off2 * 60_000;
    // Horário inexistente (madrugada que "pulou" na entrada do horário de
    // verão): o instante cai fora da hora pedida. Aceitamos o resultado, que
    // equivale ao primeiro instante válido depois do salto.
  }

  return new Date(t);
}

/** Soma dias a uma data local, sem passar por fuso (aritmética de calendário). */
export function somarDias(data: DataLocal, dias: number): DataLocal {
  if (!RE_DATA.test(data)) throw new Error(`data local inválida: ${data}`);
  const [ano, mes, dia] = data.split("-").map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Diferença em dias de calendário entre duas datas locais (b - a). */
export function diasEntre(a: DataLocal, b: DataLocal): number {
  const ms =
    Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/**
 * Empurra um instante para dentro do expediente da organização.
 * Usado para não disparar cobrança de madrugada nem no domingo.
 */
export function dentroDoExpediente(
  instante: Date,
  cfg: {
    fuso: string;
    horarioInicio: HoraLocal;
    horarioFim: HoraLocal;
    diasSemana: number[];
  },
): Date {
  if (cfg.diasSemana.length === 0) return instante;

  let data = dataLocalDe(instante, cfg.fuso);
  const hora = horaLocalDe(instante, cfg.fuso);
  let p = partesLocais(instante, cfg.fuso);

  // Antes de abrir, no mesmo dia útil: espera abrir.
  if (hora < cfg.horarioInicio && cfg.diasSemana.includes(p.diaSemana)) {
    return instanteDaHoraLocal(data, cfg.horarioInicio, cfg.fuso);
  }

  // Depois de fechar ou dia não atendido: primeiro horário do próximo dia útil.
  if (hora >= cfg.horarioFim || !cfg.diasSemana.includes(p.diaSemana)) {
    if (hora >= cfg.horarioFim) data = somarDias(data, 1);
    for (let i = 0; i < 8; i++) {
      const candidato = instanteDaHoraLocal(data, cfg.horarioInicio, cfg.fuso);
      p = partesLocais(candidato, cfg.fuso);
      if (cfg.diasSemana.includes(p.diaSemana)) return candidato;
      data = somarDias(data, 1);
    }
  }

  return instante;
}
