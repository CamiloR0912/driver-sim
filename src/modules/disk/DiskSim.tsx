import { useEffect, useMemo, useState } from "react";
import { useLoop } from "../../hooks/useLoop";
import { Callout, ModuleHeader, Panel, PlayControls, Segmented, Stat, Toggle } from "../../components/ui";
import {
  ALGORITHMS,
  ALGO_INFO,
  runAlgorithm,
  segments,
  totalMovement,
  type AlgoId,
  type Direction,
  type DiskRun,
  type Segment,
} from "./algorithms";

const EXAMPLE = "98, 183, 37, 122, 14, 124, 65, 67";
const CYL_PER_SEC = 70;
const MAX_REQUESTS = 16;

function parseQueue(text: string, max: number) {
  const tokens = text.split(/[\s,;]+/).filter(Boolean);
  const values: number[] = [];
  const bad: string[] = [];
  for (const t of tokens) {
    const n = Number(t);
    if (Number.isInteger(n) && n >= 0 && n <= max) values.push(n);
    else bad.push(t);
  }
  return { values: values.slice(0, MAX_REQUESTS), bad, truncated: values.length > MAX_REQUESTS };
}

export default function DiskSim() {
  const [queueText, setQueueText] = useState(EXAMPLE);
  const [head, setHead] = useState(53);
  const [maxCyl, setMaxCyl] = useState(199);
  const [dir, setDir] = useState<Direction>("down");
  const [algo, setAlgo] = useState<AlgoId>("FCFS");
  const [countJumps, setCountJumps] = useState(true);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [traveled, setTraveled] = useState(0);

  const parsed = useMemo(() => parseQueue(queueText, maxCyl), [queueText, maxCyl]);
  const safeHead = Math.min(Math.max(0, Math.round(head) || 0), maxCyl);
  const run = useMemo(() => runAlgorithm(algo, parsed.values, safeHead, maxCyl, dir), [algo, parsed.values, safeHead, maxCyl, dir]);
  const segs = useMemo(() => segments(run), [run]);
  const cum = useMemo(() => {
    const c = [0];
    segs.forEach((s) => c.push(c[c.length - 1] + s.distance));
    return c;
  }, [segs]);
  const pathLen = cum[cum.length - 1];
  const done = traveled >= pathLen - 1e-6;

  useEffect(() => {
    setTraveled(0);
    setRunning(false);
  }, [run]);

  useLoop(running, (dt) => setTraveled((t) => Math.min(pathLen, t + dt * CYL_PER_SEC * speed)));

  useEffect(() => {
    if (running && done) setRunning(false);
  }, [running, done]);

  // Segmento en curso y posición interpolada del cabezal
  let cur = segs.findIndex((_, i) => traveled < cum[i + 1] - 1e-9);
  if (cur === -1) cur = segs.length;
  let headPos = run.sequence[run.sequence.length - 1];
  let yPos = run.sequence.length - 1;
  if (cur < segs.length) {
    const s = segs[cur];
    const frac = s.distance === 0 ? 0 : (traveled - cum[cur]) / s.distance;
    headPos = s.from + (s.to - s.from) * frac;
    yPos = cur + frac;
  }
  const reached = Math.min(cur, run.sequence.length - 1);

  const counted = segs.reduce((acc, s, i) => {
    if (s.jump && !countJumps) return acc;
    return acc + Math.min(Math.max(traveled - cum[i], 0), s.distance);
  }, 0);
  const total = totalMovement(run, countJumps);

  // Qué peticiones ya se atendieron (para marcarlas en el eje)
  const served = useMemo(() => {
    const flags = parsed.values.map(() => false);
    for (let i = 1; i <= reached; i++) {
      const v = run.sequence[i];
      const k = parsed.values.findIndex((q, j) => q === v && !flags[j]);
      if (k >= 0) flags[k] = true;
    }
    return flags;
  }, [parsed.values, run, reached]);
  const servedCount = served.filter(Boolean).length;

  const comparison = useMemo(
    () =>
      ALGORITHMS.map((id) => ({
        id,
        total: totalMovement(runAlgorithm(id, parsed.values, safeHead, maxCyl, dir), countJumps),
      })),
    [parsed.values, safeHead, maxCyl, dir, countJumps],
  );
  const best = Math.min(...comparison.map((c) => c.total));
  const worst = Math.max(1, ...comparison.map((c) => c.total));

  const step = () => {
    const next = cum.find((c) => c > traveled + 1e-6);
    setTraveled(next ?? pathLen);
  };

  const randomize = () => {
    const n = 8;
    const vals = Array.from({ length: n }, () => Math.floor(Math.random() * (maxCyl + 1)));
    setQueueText(vals.join(", "));
    setHead(Math.floor(Math.random() * (maxCyl + 1)));
  };

  const loadExample = () => {
    setQueueText(EXAMPLE);
    setHead(53);
    setMaxCyl(199);
    setDir("down");
  };

  const info = ALGO_INFO[algo];

  return (
    <div className="module">
      <ModuleHeader tag="Sección 8 del documento" title="Planificación de E/S en disco">
        Elige un algoritmo y observa cómo se mueve el cabezal del disco duro. El objetivo de todos es reducir el
        recorrido total (tiempo de búsqueda); la diferencia está en el orden en que atienden las peticiones.
      </ModuleHeader>

      <div className="disk-layout">
        <Panel title="Configuración" className="disk-config">
          <label className="field">
            <span>Cola de peticiones (cilindros)</span>
            <textarea rows={2} value={queueText} onChange={(e) => setQueueText(e.target.value)} />
            {parsed.bad.length > 0 && <small className="error">Valores ignorados: {parsed.bad.join(", ")}</small>}
            {parsed.truncated && <small className="error">Se usan solo las primeras {MAX_REQUESTS} peticiones.</small>}
          </label>
          <div className="field-row">
            <label className="field">
              <span>Cabezal inicial</span>
              <input type="number" min={0} max={maxCyl} value={head} onChange={(e) => setHead(Number(e.target.value))} />
            </label>
            <label className="field">
              <span>Último cilindro</span>
              <input type="number" min={20} max={999} value={maxCyl} onChange={(e) => setMaxCyl(Math.max(20, Math.min(999, Number(e.target.value) || 20)))} />
            </label>
          </div>
          <div className="field">
            <span>Dirección inicial</span>
            <Segmented
              options={[
                { value: "down", label: "← Hacia 0" },
                { value: "up", label: `Hacia ${maxCyl} →` },
              ]}
              value={dir}
              onChange={setDir}
            />
          </div>
          <Toggle
            label="Contar el salto de retorno"
            checked={countJumps}
            onChange={setCountJumps}
            hint="En C-SCAN y C-LOOK, algunos libros suman el salto de regreso y otros no"
          />
          <div className="btn-row">
            <button type="button" className="btn" onClick={loadExample}>
              Ejemplo del documento
            </button>
            <button type="button" className="btn" onClick={randomize}>
              Aleatoria
            </button>
          </div>
        </Panel>

        <div className="disk-main">
          <div className="algo-pills">
            {ALGORITHMS.map((id) => (
              <button key={id} type="button" className={`algo-pill ${id === algo ? "active" : ""}`} onClick={() => setAlgo(id)}>
                {id}
              </button>
            ))}
          </div>

          <Panel
            title={
              <>
                {algo} <span className="muted">· {info.name}</span>
              </>
            }
            subtitle={info.summary}
            actions={info.starvation ? <span className="badge red">Puede causar inanición</span> : <span className="badge green">Sin inanición</span>}
          >
            <DiskChart run={run} segs={segs} maxCyl={maxCyl} cur={cur} headPos={headPos} yPos={yPos} reached={reached} queue={parsed.values} served={served} />
            <div className="disk-footer">
              <PlayControls
                running={running}
                onToggle={() => (done ? undefined : setRunning((r) => !r))}
                onStep={step}
                onReset={() => {
                  setRunning(false);
                  setTraveled(0);
                }}
                speed={speed}
                onSpeed={setSpeed}
                done={done}
              />
              <div className="stats-row">
                <Stat label="Recorrido acumulado" value={`${Math.round(counted)} cil.`} tone="accent" />
                <Stat label="Recorrido total" value={done ? `${total} cil.` : "…"} tone="orange" />
                <Stat label="Peticiones atendidas" value={`${servedCount} / ${parsed.values.length}`} />
                <Stat label="Posición del cabezal" value={Math.round(headPos)} />
              </div>
            </div>
          </Panel>
        </div>
      </div>

      <div className="grid-2">
        <Panel title="Paso a paso" subtitle="Distancia recorrida en cada movimiento del cabezal">
          <SegmentTable segs={segs} cur={done ? -1 : cur} countJumps={countJumps} />
        </Panel>

        <Panel title="Comparación de los 6 algoritmos" subtitle="Misma cola, misma posición y misma dirección inicial">
          <div className="bars">
            {comparison.map((c) => (
              <button key={c.id} type="button" className={`bar-row ${c.id === algo ? "active" : ""}`} onClick={() => setAlgo(c.id)}>
                <span className="bar-label">{c.id}</span>
                <span className="bar-track">
                  <span className={`bar-fill ${c.total === best ? "best" : ""}`} style={{ width: `${(c.total / worst) * 100}%` }} />
                </span>
                <span className="bar-value">{c.total}</span>
              </button>
            ))}
          </div>
          <Callout tone="accent" title="¿Cuál conviene?">
            El menor recorrido aquí es <strong>{comparison.filter((c) => c.total === best).map((c) => c.id).join(" y ")}</strong> con{" "}
            {best} cilindros. SSTF suele recorrer poco, pero puede dejar peticiones lejanas esperando indefinidamente;
            SCAN y LOOK garantizan que toda petición se atiende en a lo sumo una pasada.
          </Callout>
        </Panel>
      </div>
    </div>
  );
}

function DiskChart({
  run,
  segs,
  maxCyl,
  cur,
  headPos,
  yPos,
  reached,
  queue,
  served,
}: {
  run: DiskRun;
  segs: Segment[];
  maxCyl: number;
  cur: number;
  headPos: number;
  yPos: number;
  reached: number;
  queue: number[];
  served: boolean[];
}) {
  const W = 760;
  const PL = 40;
  const PR = 44;
  const TOP = 74;
  const n = run.sequence.length;
  const rowH = Math.max(24, Math.min(42, 380 / Math.max(1, n - 1)));
  const H = TOP + rowH * Math.max(1, n - 1) + 30;
  const axisY = TOP - 30;
  const x = (c: number) => PL + ((W - PL - PR) * c) / Math.max(1, maxCyl);
  const y = (i: number) => TOP + i * rowH;
  const tickStep = Math.max(10, Math.ceil(maxCyl / 4 / 10) * 10);
  const ticks: number[] = [];
  for (let t = 0; t <= maxCyl - tickStep * 0.6; t += tickStep) ticks.push(t);
  ticks.push(maxCyl);

  return (
    <svg className="disk-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Movimiento del cabezal">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={axisY} y2={H - 16} className="grid-line" />
          <text x={x(t)} y={axisY - 22} textAnchor="middle" className="tick-label">
            {t}
          </text>
        </g>
      ))}
      <line x1={x(0)} x2={x(maxCyl)} y1={axisY} y2={axisY} className="axis-line" />
      <text x={x(maxCyl) + 8} y={axisY + 4} className="tick-label">
        cil.
      </text>

      {queue.map((q, i) => (
        <circle key={i} cx={x(q)} cy={axisY} r={5} className={served[i] ? "req served" : "req"}>
          <title>Petición al cilindro {q}</title>
        </circle>
      ))}

      {/* Recorrido completo (tenue) */}
      {segs.map((s) => (
        <line key={`f${s.index}`} x1={x(s.from)} y1={y(s.index)} x2={x(s.to)} y2={y(s.index + 1)} className={s.jump ? "path-ghost jump" : "path-ghost"} />
      ))}

      {/* Recorrido ya realizado */}
      {segs.map((s) => {
        if (s.index > cur) return null;
        const x2 = s.index < cur ? x(s.to) : x(headPos);
        const y2 = s.index < cur ? y(s.index + 1) : y(yPos);
        return <line key={`d${s.index}`} x1={x(s.from)} y1={y(s.index)} x2={x2} y2={y2} className={s.jump ? "path-done jump" : "path-done"} />;
      })}

      {run.sequence.map((v, i) => {
        const isReached = i <= reached;
        const labelRight = x(v) < W - PR - 30;
        return (
          <g key={i} className={isReached ? "pt reached" : "pt"}>
            <circle cx={x(v)} cy={y(i)} r={i === 0 ? 6 : 5} className={i === 0 ? "pt-start" : ""} />
            <text x={labelRight ? x(v) + 10 : x(v) - 10} y={y(i) + 4} textAnchor={labelRight ? "start" : "end"}>
              {v}
            </text>
          </g>
        );
      })}

      {/* Cabezal */}
      <g className="head-marker" transform={`translate(${x(headPos)}, 0)`}>
        <path d={`M-7 ${axisY - 16} L7 ${axisY - 16} L0 ${axisY - 6} Z`} />
        <circle cx={0} cy={y(yPos)} r={8} />
      </g>
    </svg>
  );
}

function SegmentTable({ segs, cur, countJumps }: { segs: Segment[]; cur: number; countJumps: boolean }) {
  let acc = 0;
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Desde</th>
            <th>Hasta</th>
            <th>Distancia</th>
            <th>Acumulado</th>
          </tr>
        </thead>
        <tbody>
          {segs.map((s) => {
            const counts = !(s.jump && !countJumps);
            if (counts) acc += s.distance;
            return (
              <tr key={s.index} className={`${s.index === cur ? "current" : ""} ${s.jump ? "jump-row" : ""}`}>
                <td>{s.index + 1}</td>
                <td>{s.from}</td>
                <td>{s.to}</td>
                <td>
                  |{s.to} − {s.from}| = {s.distance}
                  {s.jump && <span className="badge gray">{counts ? "retorno" : "retorno (no se cuenta)"}</span>}
                </td>
                <td>{acc}</td>
              </tr>
            );
          })}
          {segs.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                Agrega peticiones a la cola.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
