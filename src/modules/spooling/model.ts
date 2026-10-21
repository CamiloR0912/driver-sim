export type Mode = "direct" | "exclusive" | "spool";
export type ProcStatus = "idle" | "blocked" | "writing" | "working";

export interface Proc {
  id: string;
  app: string;
  color: string;
  pages: number;
  /** Páginas enviadas a la impresora (modos sin spooling). */
  sent: number;
  printed: number;
  status: ProcStatus;
  submitAt: number;
  releasedAt: number | null;
  blocked: number;
  spoolProgress: number;
}

export interface Job {
  id: number;
  proc: string;
  pages: number;
  dispatched: number;
  printed: number;
}

export interface Page {
  proc: string;
  page: number;
  of: number;
}

export interface LogLine {
  id: number;
  t: number;
  text: string;
  kind: "info" | "warn" | "ok" | "user";
}

export interface SpoolState {
  t: number;
  started: boolean;
  finished: boolean;
  procs: Proc[];
  printing: (Page & { jobId: number | null }) | null;
  progress: number;
  paperOut: boolean;
  queue: Job[];
  tray: Page[];
  log: LogLine[];
  seq: number;
  owner: string | null;
  rr: number;
  nextJob: number;
}

export const COLORS = ["#2c3cc9", "#d2550e", "#1d7f47", "#8e44ad"];
const APPS = ["Word", "Excel", "PDF", "Navegador"];
const DEFAULT_PAGES = [3, 2, 4, 2];

export function makeProcs(count: number, random: boolean): Proc[] {
  return Array.from({ length: count }, (_, i) => ({
    id: "ABCD"[i],
    app: APPS[i],
    color: COLORS[i],
    pages: random ? 2 + Math.floor(Math.random() * 4) : DEFAULT_PAGES[i],
    sent: 0,
    printed: 0,
    status: "idle" as ProcStatus,
    submitAt: i * 0.25,
    releasedAt: null,
    blocked: 0,
    spoolProgress: 0,
  }));
}

export function initState(procs: Proc[]): SpoolState {
  return {
    t: 0,
    started: false,
    finished: false,
    procs: structuredClone(procs),
    printing: null,
    progress: 0,
    paperOut: false,
    queue: [],
    tray: [],
    log: [],
    seq: 0,
    owner: null,
    rr: 0,
    nextJob: 101,
  };
}

export const spoolWriteTime = (pages: number) => 0.3 + 0.1 * pages;
export const spoolFile = (jobId: number) => `/var/spool/cups/d00${jobId}-001`;

function log(s: SpoolState, kind: LogLine["kind"], text: string) {
  s.log.push({ id: s.seq++, t: s.t, kind, text });
  if (s.log.length > 80) s.log.splice(0, s.log.length - 80);
}

export function start(prev: SpoolState): SpoolState {
  return { ...prev, started: true };
}

export function togglePaper(prev: SpoolState): SpoolState {
  const s = structuredClone(prev);
  s.paperOut = !s.paperOut;
  if (s.paperOut) log(s, "warn", "Impresora: ¡sin papel! La impresión se detiene");
  else log(s, "ok", "Impresora: papel recargado, se reanuda la impresión");
  return s;
}

export function step(prev: SpoolState, dt: number, mode: Mode, secPerPage: number): SpoolState {
  if (!prev.started || prev.finished) return prev;
  const s = structuredClone(prev);
  s.t += dt;

  // Procesos
  for (const p of s.procs) {
    if (p.status === "idle" && p.releasedAt === null && s.t >= p.submitAt) {
      if (mode === "spool") {
        p.status = "writing";
        log(s, "user", `Proceso ${p.id} (${p.app}): lp documento.${p.app.toLowerCase()} — ${p.pages} pág.`);
      } else {
        p.status = "blocked";
        log(s, "user", `Proceso ${p.id} (${p.app}): write("/dev/usb/lp0") — ${p.pages} pág.`);
      }
    }
    if (p.status === "blocked" || p.status === "writing") p.blocked += dt;
    if (p.status === "writing") {
      p.spoolProgress += dt;
      if (p.spoolProgress >= spoolWriteTime(p.pages)) {
        const job: Job = { id: s.nextJob++, proc: p.id, pages: p.pages, dispatched: 0, printed: 0 };
        s.queue.push(job);
        p.status = "working";
        p.releasedAt = s.t;
        log(s, "ok", `spooler: trabajo ${job.id} guardado en ${spoolFile(job.id)}; el Proceso ${p.id} sigue trabajando`);
      }
    }
  }

  // Impresora
  if (!s.paperOut) {
    if (s.printing) {
      s.progress += dt / secPerPage;
      if (s.progress >= 1) {
        const pg = s.printing;
        s.tray.push({ proc: pg.proc, page: pg.page, of: pg.of });
        const p = s.procs.find((x) => x.id === pg.proc) as Proc;
        p.printed++;
        if (pg.jobId !== null) {
          const job = s.queue.find((j) => j.id === pg.jobId) as Job;
          job.printed++;
          if (job.printed === job.pages) {
            s.queue = s.queue.filter((j) => j.id !== job.id);
            log(s, "ok", `demonio: trabajo ${job.id} (Proceso ${job.proc}) impreso completo y eliminado de la cola`);
          }
        } else if (p.printed === p.pages) {
          p.status = "working";
          p.releasedAt = s.t;
          log(s, "ok", `Proceso ${p.id}: write() terminó; por fin puede continuar`);
          if (mode === "exclusive") s.owner = null;
        }
        s.printing = null;
        s.progress = 0;
      }
    }

    if (!s.printing) {
      if (mode === "direct") {
        const cands = s.procs.filter((p) => p.status === "blocked" && p.sent < p.pages);
        if (cands.length) {
          const p = cands[s.rr % cands.length];
          s.rr++;
          p.sent++;
          s.printing = { proc: p.id, page: p.sent, of: p.pages, jobId: null };
        }
      } else if (mode === "exclusive") {
        if (!s.owner) {
          const first = s.procs.filter((p) => p.status === "blocked" && p.sent < p.pages).sort((a, b) => a.submitAt - b.submitAt)[0];
          if (first) {
            s.owner = first.id;
            const waiting = s.procs.filter((p) => p.status === "blocked" && p.id !== first.id).map((p) => p.id);
            log(s, "info", `Proceso ${first.id} obtiene la impresora en exclusiva${waiting.length ? `; ${waiting.join(", ")} quedan bloqueados` : ""}`);
          }
        }
        const p = s.procs.find((x) => x.id === s.owner);
        if (p && p.sent < p.pages) {
          p.sent++;
          s.printing = { proc: p.id, page: p.sent, of: p.pages, jobId: null };
        }
      } else {
        const job = s.queue[0];
        if (job && job.dispatched < job.pages) {
          job.dispatched++;
          if (job.dispatched === 1) log(s, "info", `demonio: toma el trabajo ${job.id} (Proceso ${job.proc}) y lo envía al driver`);
          s.printing = { proc: job.proc, page: job.dispatched, of: job.pages, jobId: job.id };
        }
      }
    }
  }

  if (s.procs.every((p) => p.printed === p.pages)) {
    s.finished = true;
    log(s, "ok", `Todos los documentos impresos en ${s.t.toFixed(1)} s`);
  }
  return s;
}

/** True si las páginas de distintos procesos quedaron intercaladas en la bandeja. */
export function isMixed(tray: Page[]): boolean {
  let changes = 0;
  for (let i = 1; i < tray.length; i++) if (tray[i].proc !== tray[i - 1].proc) changes++;
  return changes > new Set(tray.map((p) => p.proc)).size - 1;
}
