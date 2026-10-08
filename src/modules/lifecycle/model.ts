export type DrvState = "unplugged" | "bound" | "suspended";
export type Level = "user" | "info" | "ok" | "irq" | "warn" | "err" | "pm";
export type Callback = "probe" | "remove" | "open" | "release" | "read" | "write" | "ioctl" | "top" | "bottom" | "suspend" | "resume";
export type ProcName = "A" | "B";
export type IoctlCmd = "SET_BAUD" | "GET_TEMP" | "RESET";

export interface LogLine {
  id: number;
  t: number;
  level: Level;
  who?: string;
  text: string;
}

export interface Proc {
  name: ProcName;
  fd: number | null;
  /** El descriptor sigue abierto pero el dispositivo ya se retiró. */
  stale: boolean;
  sleeping: boolean;
  nonblock: boolean;
  last: string;
}

export interface DrvSimState {
  drv: DrvState;
  refs: number;
  data: string[];
  lcd: string;
  baud: number;
  procs: Proc[];
  log: LogLine[];
  seq: number;
  active: Callback | null;
  irq: boolean;
  panic: boolean;
  failNext: boolean;
}

export const BAUDS = [9600, 19200, 57600, 115200];
export const DATA_CAPACITY = 6;

export const CALLBACKS: { id: Callback; label: string; desc: string }[] = [
  { id: "probe", label: "probe()", desc: "Detecta e inicializa el dispositivo" },
  { id: "remove", label: "remove()", desc: "Libera los recursos al retirarlo" },
  { id: "open", label: "open()", desc: "Un proceso empieza a usarlo" },
  { id: "release", label: "release()", desc: "Un proceso lo cierra" },
  { id: "read", label: "read()", desc: "Entrega datos al proceso" },
  { id: "write", label: "write()", desc: "Envía datos al hardware" },
  { id: "ioctl", label: "ioctl()", desc: "Comandos de control" },
  { id: "top", label: "ISR · top half", desc: "Atiende la interrupción, muy rápido" },
  { id: "bottom", label: "Bottom half", desc: "Trabajo diferido; despierta procesos" },
  { id: "suspend", label: "suspend()", desc: "Guarda el estado y apaga" },
  { id: "resume", label: "resume()", desc: "Restaura el estado" },
];

const T0 = performance.now();

export function log(s: DrvSimState, level: Level, text: string, who?: string) {
  s.log.push({ id: s.seq++, t: (performance.now() - T0) / 1000, level, text, who });
  if (s.log.length > 400) s.log.splice(0, s.log.length - 400);
}

export function proc(s: DrvSimState, name: ProcName): Proc {
  return s.procs.find((p) => p.name === name) as Proc;
}

export function reading(): string {
  return `T=${(20 + Math.random() * 8).toFixed(1)}C`;
}

export function initialState(): DrvSimState {
  const s: DrvSimState = {
    drv: "unplugged",
    refs: 0,
    data: [],
    lcd: "",
    baud: 9600,
    procs: (["A", "B"] as ProcName[]).map((name) => ({ name, fd: null, stale: false, sleeping: false, nonblock: false, last: "—" })),
    log: [],
    seq: 0,
    active: null,
    irq: false,
    panic: false,
    failNext: false,
  };
  log(s, "info", "Linux version 6.8.0-so (equipo3@kernel) — sistema iniciado");
  log(s, "info", "insmod midev.ko: driver cargado; esperando un dispositivo compatible (USB 1a86:7523)");
  return s;
}
