export type AlgoId = "FCFS" | "SSTF" | "SCAN" | "C-SCAN" | "LOOK" | "C-LOOK";
export type Direction = "down" | "up";

export const ALGORITHMS: AlgoId[] = ["FCFS", "SSTF", "SCAN", "C-SCAN", "LOOK", "C-LOOK"];

export const ALGO_INFO: Record<AlgoId, { name: string; summary: string; starvation: boolean }> = {
  FCFS: {
    name: "First-Come, First-Served",
    summary: "Atiende las peticiones en el orden de llegada. Es justo, pero el cabezal va y viene de un extremo a otro.",
    starvation: false,
  },
  SSTF: {
    name: "Shortest Seek Time First",
    summary: "Siempre va a la petición más cercana. Recorre poco, pero las peticiones lejanas pueden esperar indefinidamente (inanición).",
    starvation: true,
  },
  SCAN: {
    name: "Algoritmo del elevador",
    summary: "Barre hasta el borde del disco atendiendo lo que encuentra y luego se devuelve atendiendo en el otro sentido.",
    starvation: false,
  },
  "C-SCAN": {
    name: "SCAN circular",
    summary: "Atiende en un solo sentido. Al llegar al borde salta al extremo opuesto sin atender nada y vuelve a empezar.",
    starvation: false,
  },
  LOOK: {
    name: "SCAN optimizado",
    summary: "Como SCAN, pero se devuelve en la última petición pendiente, sin llegar hasta el borde físico.",
    starvation: false,
  },
  "C-LOOK": {
    name: "C-SCAN optimizado",
    summary: "Como C-SCAN, pero salta directamente a la última petición pendiente del otro extremo.",
    starvation: false,
  },
};

export interface DiskRun {
  id: AlgoId;
  /** Posiciones visitadas por el cabezal, empezando en la posición inicial. */
  sequence: number[];
  /** Índices de los segmentos que son saltos de retorno (no atienden peticiones). */
  jumps: number[];
}

export interface Segment {
  index: number;
  from: number;
  to: number;
  distance: number;
  jump: boolean;
}

export function runAlgorithm(id: AlgoId, queue: number[], head: number, maxCyl: number, dir: Direction): DiskRun {
  const seq = [head];
  const jumps: number[] = [];
  const push = (xs: number[]) => xs.forEach((x) => seq.push(x));
  const pushEdge = (edge: number) => {
    if (seq[seq.length - 1] !== edge) seq.push(edge);
  };
  const jumpTo = (x: number) => {
    jumps.push(seq.length - 1);
    seq.push(x);
  };

  if (id === "FCFS") {
    push(queue);
    return { id, sequence: seq, jumps };
  }

  if (id === "SSTF") {
    const pending = [...queue];
    let cur = head;
    while (pending.length) {
      let best = 0;
      for (let i = 1; i < pending.length; i++) {
        if (Math.abs(pending[i] - cur) < Math.abs(pending[best] - cur)) best = i;
      }
      cur = pending.splice(best, 1)[0];
      seq.push(cur);
    }
    return { id, sequence: seq, jumps };
  }

  const same = queue.filter((x) => x === head);
  const lower = queue.filter((x) => x < head).sort((a, b) => b - a); // de cerca a lejos hacia 0
  const upper = queue.filter((x) => x > head).sort((a, b) => a - b); // de cerca a lejos hacia el máximo
  const first = dir === "down" ? lower : upper;
  const second = dir === "down" ? upper : lower;
  const nearEdge = dir === "down" ? 0 : maxCyl;
  const farEdge = dir === "down" ? maxCyl : 0;

  push(same);
  push(first);
  if (second.length === 0) return { id, sequence: seq, jumps };

  switch (id) {
    case "SCAN":
      pushEdge(nearEdge);
      push(second);
      break;
    case "C-SCAN": {
      pushEdge(nearEdge);
      jumpTo(farEdge);
      const rest = [...second].reverse();
      push(rest[0] === farEdge ? rest.slice(1) : rest);
      break;
    }
    case "LOOK":
      push(second);
      break;
    case "C-LOOK": {
      const rest = [...second].reverse();
      jumpTo(rest[0]);
      push(rest.slice(1));
      break;
    }
  }
  return { id, sequence: seq, jumps };
}

export function segments(run: DiskRun): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i < run.sequence.length - 1; i++) {
    const from = run.sequence[i];
    const to = run.sequence[i + 1];
    out.push({ index: i, from, to, distance: Math.abs(to - from), jump: run.jumps.includes(i) });
  }
  return out;
}

export function totalMovement(run: DiskRun, countJumps: boolean): number {
  return segments(run).reduce((acc, s) => acc + (s.jump && !countJumps ? 0 : s.distance), 0);
}
