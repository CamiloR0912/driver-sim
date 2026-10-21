import { useState } from "react";
import { useLoop } from "../../hooks/useLoop";
import { ModuleHeader, Panel, PlayControls, Segmented, Slider, Stat, Toggle } from "../../components/ui";
import { IconChip, IconDisk } from "../../components/Icons";
import { burstFactor, capacity, DEFAULT_SIZE, initState, occupancy, SIZE_RANGE, step, type BufState, type Mode, type Params } from "./model";

const PRESETS = [
  { id: "balanced", label: "Equilibrado", prodRate: 3, consRate: 3, burst: false },
  { id: "overflow", label: "Productor rápido", prodRate: 6, consRate: 2, burst: false },
  { id: "underflow", label: "Consumidor rápido", prodRate: 1.5, consRate: 5, burst: false },
  { id: "burst", label: "Ráfagas (red)", prodRate: 3, consRate: 3, burst: true },
];

const MODE_TEXT: Record<Mode, { title: string; text: string }> = {
  single: {
    title: "Buffer simple",
    text: "El dispositivo llena el buffer completo y solo entonces la CPU lo procesa. Mientras uno trabaja, el otro espera: ≈ T + C por bloque.",
  },
  double: {
    title: "Doble buffer",
    text: "Mientras el dispositivo llena un buffer, la CPU procesa el otro; al terminar se intercambian. La E/S y el cómputo se solapan: ≈ max(T, C) por bloque.",
  },
  ring: {
    title: "Buffer circular",
    text: "N posiciones en círculo con dos índices: head (donde escribe el productor) y tail (donde lee el consumidor). Absorbe ráfagas y solo mueve índices. Se sacrifica una posición para distinguir lleno de vacío.",
  },
};

export const itemColor = (id: number) => `hsl(${(id * 67) % 360} 62% 50%)`;

export default function BufferingSim() {
  const [params, setParams] = useState<Params>({ mode: "ring", size: DEFAULT_SIZE.ring, prodRate: 3, consRate: 3, burst: false, flowControl: false });
  const [sim, setSim] = useState<BufState>(() => initState(params));
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(1);

  useLoop(running, (dt) => setSim((s) => step(s, dt * speed, params)));

  const resetWith = (p: Params) => {
    setParams(p);
    setSim(initState(p));
  };
  const setMode = (mode: Mode) => resetWith({ ...params, mode, size: DEFAULT_SIZE[mode] });
  const setLive = (patch: Partial<Params>) => setParams((p) => ({ ...p, ...patch }));

  const occ = occupancy(sim, params);
  const cap = capacity(params);
  const pausedBurst = params.burst && burstFactor(sim.t, true) === 0;
  const overflowFlash = sim.t - sim.lastOverflow < 0.35;
  const underflowFlash = sim.t - sim.lastUnderflow < 0.35;
  const [minSize, maxSize] = SIZE_RANGE[params.mode];

  const producerState = sim.producerBlocked
    ? { text: "Bloqueado: buffer lleno", tone: "amber" }
    : overflowFlash
      ? { text: "¡Dato perdido! (overflow)", tone: "red" }
      : pausedBurst
        ? { text: "En silencio (entre ráfagas)", tone: "gray" }
        : { text: "Produciendo datos", tone: "green" };
  const consumerState = sim.consumerIdle ? { text: "Esperando: buffer vacío (underflow)", tone: "amber" } : { text: "Consumiendo datos", tone: "green" };

  return (
    <div className="module">
      <ModuleHeader tag="Sección 5 del documento" title="Buffering">
        Un buffer es memoria temporal entre un productor (el dispositivo) y un consumidor (el proceso). Ajusta las
        velocidades y observa cuándo se llena (overflow) o se vacía (underflow).
      </ModuleHeader>

      <div className="buf-layout">
        <Panel title="Parámetros" className="buf-config">
          <div className="field">
            <span>Técnica</span>
            <Segmented
              options={[
                { value: "single", label: "Simple" },
                { value: "double", label: "Doble" },
                { value: "ring", label: "Circular" },
              ]}
              value={params.mode}
              onChange={setMode}
            />
          </div>
          <Slider
            label={params.mode === "ring" ? "Posiciones del anillo (N)" : "Posiciones por buffer"}
            value={params.size}
            min={minSize}
            max={maxSize}
            onChange={(size) => resetWith({ ...params, size })}
          />
          <Slider label="Velocidad del productor" value={params.prodRate} min={0.5} max={10} step={0.5} onChange={(prodRate) => setLive({ prodRate })} format={(v) => `${v} datos/s`} />
          <Slider label="Velocidad del consumidor" value={params.consRate} min={0.5} max={10} step={0.5} onChange={(consRate) => setLive({ consRate })} format={(v) => `${v} datos/s`} />
          <Toggle label="Productor en ráfagas" checked={params.burst} onChange={(burst) => setLive({ burst })} hint="1 s al triple de velocidad y 2 s en silencio" />
          <Toggle
            label="Control de flujo"
            checked={params.flowControl}
            onChange={(flowControl) => setLive({ flowControl })}
            hint="Si está activo, el productor espera cuando el buffer está lleno en vez de perder datos"
          />
          <div className="field">
            <span>Escenarios</span>
            <div className="chip-row">
              {PRESETS.map((pr) => (
                <button
                  key={pr.id}
                  type="button"
                  className="chip-btn"
                  onClick={() => {
                    resetWith({ ...params, prodRate: pr.prodRate, consRate: pr.consRate, burst: pr.burst });
                    setRunning(true);
                  }}
                >
                  {pr.label}
                </button>
              ))}
            </div>
          </div>
        </Panel>

        <div className="buf-main">
          <Panel
            title={MODE_TEXT[params.mode].title}
            subtitle={MODE_TEXT[params.mode].text}
            actions={<span className="sim-clock">t = {sim.t.toFixed(1)} s</span>}
          >
            <div className="pipeline">
              <div className={`actor ${overflowFlash ? "flash-red" : ""}`}>
                <div className="actor-icon">
                  <IconDisk width={24} height={24} />
                </div>
                <strong>Dispositivo</strong>
                <span className="muted">productor · {params.prodRate}/s</span>
                <span className={`badge ${producerState.tone}`}>{producerState.text}</span>
              </div>
              <div className={`flow-arrow ${running && !sim.producerBlocked && !pausedBurst ? "moving" : ""}`} />
              <div className="buffer-view">
                {params.mode === "ring" ? (
                  <RingView ring={sim.ring} head={sim.head} tail={sim.tail} />
                ) : (
                  <BlocksView sim={sim} params={params} />
                )}
              </div>
              <div className={`flow-arrow ${running && !sim.consumerIdle ? "moving" : ""}`} />
              <div className={`actor ${underflowFlash ? "flash-amber" : ""}`}>
                <div className="actor-icon">
                  <IconChip width={24} height={24} />
                </div>
                <strong>Proceso</strong>
                <span className="muted">consumidor · {params.consRate}/s</span>
                <span className={`badge ${consumerState.tone}`}>{consumerState.text}</span>
                <span className="last-item">
                  Último dato:{" "}
                  {sim.lastConsumed !== null ? (
                    <span className="item" style={{ background: itemColor(sim.lastConsumed) }}>
                      {sim.lastConsumed}
                    </span>
                  ) : (
                    "—"
                  )}
                </span>
              </div>
            </div>

            <div className="buf-footer">
              <PlayControls
                running={running}
                onToggle={() => setRunning((r) => !r)}
                onReset={() => {
                  setRunning(false);
                  setSim(initState(params));
                }}
                speed={speed}
                onSpeed={setSpeed}
              />
            </div>
          </Panel>

          <div className="stats-row wide">
            <Stat label="Generados" value={sim.produced} hint="Datos producidos por el dispositivo" />
            <Stat label="Consumidos" value={sim.consumed} tone="green" />
            <Stat label="Perdidos (overflow)" value={sim.lost} tone={sim.lost ? "red" : "default"} />
            <Stat label="Buffer vacío (underflow)" value={sim.underflows} tone={sim.underflows ? "amber" : "default"} hint="Veces que el proceso pidió datos y no había" />
            <Stat label="Ocupación" value={`${occ} / ${cap}`} tone="accent" />
            {params.flowControl && <Stat label="Productor bloqueado" value={`${sim.blockedTime.toFixed(1)} s`} tone="amber" />}
          </div>
        </div>
      </div>

      <div className="grid-2">
        <Panel title="Ocupación del buffer" subtitle="Últimos 30 segundos · arriba = lleno, abajo = vacío">
          <Sparkline values={sim.history} />
        </Panel>
        <Panel title="Eventos" subtitle="Lo que pasó recientemente">
          <ul className="event-list">
            {sim.events
              .slice(-7)
              .reverse()
              .map((e) => (
                <li key={e.id} className={`ev-${e.kind}`}>
                  <span className="ev-time">{e.t.toFixed(1)} s</span>
                  {e.text}
                </li>
              ))}
            {sim.events.length === 0 && <li className="muted">Pulsa ▶ Reproducir o elige un escenario.</li>}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function Slot({ id }: { id: number | null }) {
  return <div className="slot">{id !== null && <span className="item" style={{ background: itemColor(id) }}>{id}</span>}</div>;
}

function BlocksView({ sim, params }: { sim: BufState; params: Params }) {
  const rows = sim.blocks.map((block, i) => {
    let role = "";
    let tone = "gray";
    if (params.mode === "single") {
      role = sim.phase === "filling" ? "Lo llena el dispositivo (E/S)" : "Lo vacía el proceso (CPU)";
      tone = sim.phase === "filling" ? "accent" : "orange";
    } else if (i === sim.fillIdx) {
      role = block.length === params.size ? "Lleno, esperando a la CPU" : "Lo llena el dispositivo (E/S)";
      tone = block.length === params.size ? "amber" : "accent";
    } else if (i === sim.drainIdx) {
      role = "Lo procesa la CPU";
      tone = "orange";
    } else {
      role = "Vacío, en espera";
    }
    return (
      <div key={i} className="block-row">
        <div className="block-head">
          <strong>{params.mode === "single" ? "Buffer del kernel" : `Buffer ${"AB"[i]}`}</strong>
          <span className={`badge ${tone}`}>{role}</span>
        </div>
        <div className="slots">
          {Array.from({ length: params.size }, (_, k) => (
            <Slot key={k} id={block[k] ?? null} />
          ))}
        </div>
      </div>
    );
  });
  return <div className="blocks">{rows}</div>;
}

function arcPath(cx: number, cy: number, r1: number, r2: number, a0: number, a1: number) {
  const pt = (r: number, a: number) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)];
  const [x0, y0] = pt(r2, a0);
  const [x1, y1] = pt(r2, a1);
  const [x2, y2] = pt(r1, a1);
  const [x3, y3] = pt(r1, a0);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x0} ${y0} A${r2} ${r2} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${r1} ${r1} 0 ${large} 0 ${x3} ${y3} Z`;
}

function RingView({ ring, head, tail }: { ring: (number | null)[]; head: number; tail: number }) {
  const N = ring.length;
  const cx = 170;
  const cy = 165;
  const r1 = 70;
  const r2 = 120;
  const ang = (i: number) => -90 + (i * 360) / N;
  const full = (head + 1) % N === tail;
  const empty = head === tail;

  const pointer = (i: number, label: string, cls: string, offset: number) => {
    const a = (ang(i) * Math.PI) / 180;
    const ro = r2 + 40 + offset;
    const xo = cx + ro * Math.cos(a);
    const yo = cy + ro * Math.sin(a);
    const xi = cx + (r2 + 6) * Math.cos(a);
    const yi = cy + (r2 + 6) * Math.sin(a);
    return (
      <g className={`ring-pointer ${cls}`}>
        <line x1={xo} y1={yo} x2={xi} y2={yi} markerEnd={`url(#arrow-${cls})`} />
        <text x={xo + (Math.cos(a) >= 0 ? 4 : -4)} y={yo + (Math.sin(a) >= 0 ? 14 : -6)} textAnchor={Math.cos(a) >= 0 ? "start" : "end"}>
          {label}
        </text>
      </g>
    );
  };

  return (
    <svg className="ring-view" viewBox="-80 -10 500 350" role="img" aria-label="Buffer circular">
      <defs>
        <marker id="arrow-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" className="arrow-head-fill" />
        </marker>
        <marker id="arrow-tail" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" className="arrow-tail-fill" />
        </marker>
      </defs>
      {ring.map((id, i) => {
        const a0 = ang(i);
        const a1 = ang(i + 1);
        const am = ((a0 + a1) / 2) * (Math.PI / 180);
        const rm = (r1 + r2) / 2;
        return (
          <g key={i}>
            <path d={arcPath(cx, cy, r1, r2, a0, a1)} className={id !== null ? "ring-slot filled" : "ring-slot"} style={id !== null ? { fill: itemColor(id) } : undefined} />
            {id !== null && (
              <text x={cx + rm * Math.cos(am)} y={cy + rm * Math.sin(am) + 5} textAnchor="middle" className="ring-item">
                {id}
              </text>
            )}
            <text x={cx + (r1 - 12) * Math.cos(am)} y={cy + (r1 - 12) * Math.sin(am) + 4} textAnchor="middle" className="ring-index">
              {i}
            </text>
          </g>
        );
      })}
      <text x={cx} y={cy - 4} textAnchor="middle" className="ring-center">
        N = {N}
      </text>
      <text x={cx} y={cy + 16} textAnchor="middle" className={`ring-state ${full ? "full" : empty ? "empty" : ""}`}>
        {full ? "LLENO" : empty ? "VACÍO" : `${(head - tail + N) % N} ocupadas`}
      </text>
      {pointer(tail, "tail (lee)", "tail", head === tail ? 18 : 0)}
      {pointer(head, "head (escribe)", "head", 0)}
    </svg>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const W = 600;
  const H = 120;
  const n = 120;
  const pts = values.map((v, i) => [(W * (i + n - values.length)) / (n - 1), H - 8 - v * (H - 16)]);
  const line = pts.map(([x, y]) => `${x},${y}`).join(" ");
  const area = pts.length ? `M${pts[0][0]},${H - 8} L${line.replace(/ /g, " L")} L${pts[pts.length - 1][0]},${H - 8} Z` : "";
  return (
    <svg className="sparkline" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <line x1={0} x2={W} y1={8} y2={8} className="spark-limit" />
      <line x1={0} x2={W} y1={H - 8} y2={H - 8} className="spark-base" />
      {pts.length > 1 && (
        <>
          <path d={area} className="spark-area" />
          <polyline points={line} className="spark-line" />
        </>
      )}
      <text x={6} y={22} className="spark-text">
        lleno
      </text>
      <text x={6} y={H - 14} className="spark-text">
        vacío
      </text>
    </svg>
  );
}
