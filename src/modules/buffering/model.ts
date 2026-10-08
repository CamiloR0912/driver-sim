export type Mode = "single" | "double" | "ring";

export interface Params {
  mode: Mode;
  /** Single/double: posiciones por buffer. Ring: posiciones del anillo (N). */
  size: number;
  prodRate: number;
  consRate: number;
  burst: boolean;
  flowControl: boolean;
}

export interface BufEvent {
  id: number;
  t: number;
  kind: "overflow" | "underflow" | "swap" | "block";
  text: string;
}

export interface BufState {
  t: number;
  prodAcc: number;
  consAcc: number;
  nextId: number;
  // Buffer simple y doble
  blocks: number[][];
  fillIdx: number;
  drainIdx: number | null;
  phase: "filling" | "draining";
  // Buffer circular
  ring: (number | null)[];
  head: number;
  tail: number;
  // Métricas
  produced: number;
  consumed: number;
  lost: number;
  underflows: number;
  blockedTime: number;
  history: number[];
  sampleAcc: number;
  events: BufEvent[];
  eventSeq: number;
  lastOverflow: number;
  lastUnderflow: number;
  producerBlocked: boolean;
  consumerIdle: boolean;
  lastConsumed: number | null;
}

export const DEFAULT_SIZE: Record<Mode, number> = { single: 4, double: 4, ring: 8 };
export const SIZE_RANGE: Record<Mode, [number, number]> = { single: [2, 8], double: [2, 8], ring: [4, 16] };

export function initState(p: Params): BufState {
  return {
    t: 0,
    prodAcc: 0,
    consAcc: 0,
    nextId: 1,
    blocks: p.mode === "double" ? [[], []] : [[]],
    fillIdx: 0,
    drainIdx: null,
    phase: "filling",
    ring: Array.from({ length: p.size }, () => null),
    head: 0,
    tail: 0,
    produced: 0,
    consumed: 0,
    lost: 0,
    underflows: 0,
    blockedTime: 0,
    history: [],
    sampleAcc: 0,
    events: [],
    eventSeq: 0,
    lastOverflow: -10,
    lastUnderflow: -10,
    producerBlocked: false,
    consumerIdle: false,
    lastConsumed: null,
  };
}

/** Datos que caben en total. En el anillo se sacrifica una posición para distinguir lleno de vacío. */
export function capacity(p: Params): number {
  if (p.mode === "single") return p.size;
  if (p.mode === "double") return p.size * 2;
  return p.size - 1;
}

export function occupancy(s: BufState, p: Params): number {
  if (p.mode === "ring") return (s.head - s.tail + p.size) % p.size;
  return s.blocks.reduce((a, b) => a + b.length, 0);
}

/** Ráfagas: 1 s produciendo al triple de la tasa y 2 s en silencio (mismo promedio). */
export function burstFactor(t: number, burst: boolean): number {
  if (!burst) return 1;
  return t % 3 < 1 ? 3 : 0;
}

function hasSpace(s: BufState, p: Params): boolean {
  if (p.mode === "single") return s.phase === "filling" && s.blocks[0].length < p.size;
  if (p.mode === "double") return s.blocks[s.fillIdx].length < p.size;
  return (s.head + 1) % p.size !== s.tail;
}

function event(s: BufState, kind: BufEvent["kind"], text: string) {
  s.events.push({ id: s.eventSeq++, t: s.t, kind, text });
  if (s.events.length > 40) s.events.splice(0, s.events.length - 40);
}

function swap(s: BufState) {
  s.drainIdx = s.fillIdx;
  s.fillIdx = 1 - s.fillIdx;
  event(s, "swap", `Intercambio: la CPU procesa el buffer ${"AB"[s.drainIdx]} y el dispositivo llena el ${"AB"[s.fillIdx]}`);
}

function put(s: BufState, p: Params, id: number) {
  if (p.mode === "single") {
    s.blocks[0].push(id);
    if (s.blocks[0].length === p.size) s.phase = "draining";
  } else if (p.mode === "double") {
    s.blocks[s.fillIdx].push(id);
    if (s.blocks[s.fillIdx].length === p.size && s.drainIdx === null) swap(s);
  } else {
    s.ring[s.head] = id;
    s.head = (s.head + 1) % p.size;
  }
}

function canTake(s: BufState, p: Params): boolean {
  if (p.mode === "single") return s.phase === "draining" && s.blocks[0].length > 0;
  if (p.mode === "double") return s.drainIdx !== null && s.blocks[s.drainIdx].length > 0;
  return s.head !== s.tail;
}

function take(s: BufState, p: Params): number {
  let id: number;
  if (p.mode === "single") {
    id = s.blocks[0].shift() as number;
    if (s.blocks[0].length === 0) s.phase = "filling";
  } else if (p.mode === "double") {
    const d = s.drainIdx as number;
    id = s.blocks[d].shift() as number;
    if (s.blocks[d].length === 0) {
      s.drainIdx = null;
      if (s.blocks[s.fillIdx].length === p.size) swap(s);
    }
  } else {
    id = s.ring[s.tail] as number;
    s.ring[s.tail] = null;
    s.tail = (s.tail + 1) % p.size;
  }
  return id;
}

export function step(prev: BufState, dt: number, p: Params): BufState {
  const s = structuredClone(prev);
  s.t += dt;

  // Productor (el dispositivo)
  s.prodAcc += p.prodRate * burstFactor(s.t, p.burst) * dt;
  const wasBlocked = s.producerBlocked;
  s.producerBlocked = false;
  while (s.prodAcc >= 1) {
    if (hasSpace(s, p)) {
      put(s, p, s.nextId++);
      s.produced++;
      s.prodAcc -= 1;
    } else if (p.flowControl) {
      s.prodAcc = 1;
      s.producerBlocked = true;
      s.blockedTime += dt;
      if (!wasBlocked) event(s, "block", "Buffer lleno: el dispositivo espera (control de flujo)");
      break;
    } else {
      const id = s.nextId++;
      s.produced++;
      s.lost++;
      s.prodAcc -= 1;
      s.lastOverflow = s.t;
      event(s, "overflow", `Overflow: el dato #${id} se perdió porque el buffer estaba lleno`);
    }
  }

  // Consumidor (el proceso)
  s.consAcc += p.consRate * dt;
  while (s.consAcc >= 1) {
    s.consAcc -= 1;
    if (canTake(s, p)) {
      s.lastConsumed = take(s, p);
      s.consumed++;
      s.consumerIdle = false;
    } else {
      s.underflows++;
      s.lastUnderflow = s.t;
      if (!s.consumerIdle) event(s, "underflow", "Underflow: el proceso quiere datos pero no hay nada listo");
      s.consumerIdle = true;
    }
  }

  // Historial de ocupación (cada 0.25 s, últimos 30 s)
  s.sampleAcc += dt;
  while (s.sampleAcc >= 0.25) {
    s.sampleAcc -= 0.25;
    s.history.push(occupancy(s, p) / capacity(p));
    if (s.history.length > 120) s.history.shift();
  }
  return s;
}
