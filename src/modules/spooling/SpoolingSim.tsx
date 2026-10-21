import { useEffect, useRef, useState } from "react";
import { useLoop } from "../../hooks/useLoop";
import { ModuleHeader, Panel, PlayControls, Segmented, Slider, Stat } from "../../components/ui";
import { initState, isMixed, makeProcs, spoolFile, spoolWriteTime, start, step, togglePaper, type Mode, type Proc, type SpoolState } from "./model";

const MODES: { value: Mode; label: string }[] = [
  { value: "direct", label: "Sin spooling (sin control)" },
  { value: "exclusive", label: "Sin spooling (exclusivo)" },
  { value: "spool", label: "Con spooling" },
];

const MODE_TEXT: Record<Mode, string> = {
  direct: "Todos los procesos escriben directamente en la impresora al mismo tiempo. La impresora imprime lo que le llega, en el orden en que llega.",
  exclusive: "El primer proceso que llega se queda con la impresora hasta terminar; los demás quedan bloqueados esperando su turno.",
  spool: "Cada proceso deja su documento completo en la cola de spool (en disco) y sigue trabajando. El demonio de impresión los envía a la impresora de uno en uno.",
};

const STATUS: Record<Proc["status"], { text: string; tone: string }> = {
  idle: { text: "Listo para imprimir", tone: "gray" },
  blocked: { text: "Bloqueado esperando la impresora", tone: "red" },
  writing: { text: "Guardando en el spool…", tone: "amber" },
  working: { text: "Sigue trabajando ✓", tone: "green" },
};

interface RunResult {
  n: number;
  mode: Mode;
  total: number;
  avgBlocked: number;
  maxBlocked: number;
  mixed: boolean;
}

export default function SpoolingSim() {
  const [mode, setMode] = useState<Mode>("direct");
  const [count, setCount] = useState(3);
  const [secPerPage, setSecPerPage] = useState(1.2);
  const [template, setTemplate] = useState(() => makeProcs(3, false));
  const [sim, setSim] = useState<SpoolState>(() => initState(template));
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [results, setResults] = useState<RunResult[]>([]);
  const recorded = useRef(false);
  const logRef = useRef<HTMLDivElement>(null);

  useLoop(running, (dt) => setSim((s) => step(s, dt * speed, mode, secPerPage)));

  useEffect(() => {
    if (sim.finished && !recorded.current) {
      recorded.current = true;
      setRunning(false);
      const blocked = sim.procs.map((p) => p.blocked);
      setResults((r) => [
        ...r,
        {
          n: r.length + 1,
          mode,
          total: sim.t,
          avgBlocked: blocked.reduce((a, b) => a + b, 0) / blocked.length,
          maxBlocked: Math.max(...blocked),
          mixed: isMixed(sim.tray),
        },
      ]);
    }
  }, [sim.finished, sim.procs, sim.t, sim.tray, mode]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [sim.log.length]);

  const reset = (procs = template) => {
    setRunning(false);
    recorded.current = false;
    setSim(initState(procs));
  };
  const changeMode = (m: Mode) => {
    setMode(m);
    reset();
  };
  const changeCount = (c: number) => {
    setCount(c);
    const procs = makeProcs(c, false);
    setTemplate(procs);
    reset(procs);
  };
  const randomDocs = () => {
    const procs = makeProcs(count, true);
    setTemplate(procs);
    reset(procs);
  };

  const toggleRun = () => {
    if (!sim.started) setSim((s) => start(s));
    setRunning((r) => !r);
  };

  const colorOf = (id: string) => sim.procs.find((p) => p.id === id)?.color ?? "#888";
  const mixed = isMixed(sim.tray);

  return (
    <div className="module">
      <ModuleHeader tag="Sección 6 del documento" title="Spooling: impresora compartida">
        Varios procesos quieren imprimir al mismo tiempo en una sola impresora. Compara los tres modos y fíjate en dos
        cosas: si las páginas salen mezcladas y cuánto tiempo pasa cada proceso bloqueado.
      </ModuleHeader>

      <Panel className="spool-toolbar">
        <div className="toolbar">
          <Segmented options={MODES} value={mode} onChange={changeMode} disabled={sim.started && !sim.finished} />
          <div className="toolbar-sliders">
            <Slider label="Procesos" value={count} min={2} max={4} onChange={changeCount} disabled={sim.started && !sim.finished} />
            <Slider label="Impresora" value={secPerPage} min={0.5} max={2.5} step={0.1} onChange={setSecPerPage} format={(v) => `${v.toFixed(1)} s/pág.`} />
          </div>
          <button type="button" className="btn" onClick={randomDocs} disabled={sim.started && !sim.finished}>
            Documentos aleatorios
          </button>
        </div>
        <p className="mode-text">{MODE_TEXT[mode]}</p>
        <PlayControls running={running} onToggle={toggleRun} onReset={() => reset()} speed={speed} onSpeed={setSpeed} done={sim.finished} playLabel={sim.started ? "Continuar" : "Enviar a imprimir"} />
      </Panel>

      <div className="spool-layout">
        <Panel title="Procesos" subtitle={`t = ${sim.t.toFixed(1)} s`}>
          <div className="proc-list">
            {sim.procs.map((p) => (
              <div key={p.id} className="proc-card" style={{ borderLeftColor: p.color }}>
                <div className="proc-top">
                  <strong>
                    Proceso {p.id} <span className="muted">· {p.app}</span>
                  </strong>
                  <span className="muted">{p.pages} pág.</span>
                </div>
                <span className={`badge ${STATUS[p.status].tone}`}>{STATUS[p.status].text}</span>
                <div className="progress">
                  <span style={{ width: `${(p.printed / p.pages) * 100}%`, background: p.color }} />
                </div>
                <div className="proc-meta">
                  <span>
                    Impresas: {p.printed}/{p.pages}
                  </span>
                  <span className={p.blocked > 2 ? "text-red" : ""}>Bloqueado: {p.blocked.toFixed(1)} s</span>
                </div>
                {p.status === "writing" && (
                  <div className="progress thin">
                    <span style={{ width: `${Math.min(100, (p.spoolProgress / spoolWriteTime(p.pages)) * 100)}%` }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </Panel>

        <div className="spool-center">
          <Panel title={mode === "spool" ? "Cola de spool (disco)" : "Sin cola"} subtitle={mode === "spool" ? "$ lpq" : "Los procesos escriben directo en /dev/usb/lp0"}>
            {mode === "spool" ? (
              <table className="data-table compact">
                <thead>
                  <tr>
                    <th>Orden</th>
                    <th>Trabajo</th>
                    <th>Proc.</th>
                    <th>Archivo</th>
                    <th>Progreso</th>
                  </tr>
                </thead>
                <tbody>
                  {sim.queue.map((j, i) => (
                    <tr key={j.id}>
                      <td>{i === 0 ? <span className="badge accent">activo</span> : `${i + 1}.º`}</td>
                      <td>{j.id}</td>
                      <td>
                        <span className="dot" style={{ background: colorOf(j.proc) }} />
                        {j.proc}
                      </td>
                      <td className="mono">{spoolFile(j.id)}</td>
                      <td>
                        {j.printed}/{j.pages}
                      </td>
                    </tr>
                  ))}
                  {sim.queue.length === 0 && (
                    <tr>
                      <td colSpan={5} className="muted">
                        La cola está vacía.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            ) : (
              <p className="muted small">
                No hay spooler ni área intermedia: cada proceso queda bloqueado hasta que la impresora termina sus páginas.
                {mode === "exclusive" && sim.owner && (
                  <>
                    {" "}
                    Ahora mismo la tiene el <strong style={{ color: colorOf(sim.owner) }}>Proceso {sim.owner}</strong>.
                  </>
                )}
              </p>
            )}
          </Panel>

          <Panel
            title="Impresora"
            actions={
              <button type="button" className={`btn ${sim.paperOut ? "primary" : ""}`} onClick={() => setSim((s) => togglePaper(s))}>
                {sim.paperOut ? "Recargar papel" : "Quitar el papel"}
              </button>
            }
          >
            <div className="printer">
              <div className={`printer-body ${sim.paperOut ? "paper-out" : ""} ${sim.printing && !sim.paperOut ? "busy" : ""}`}>
                <div className="printer-slot" />
                <div className="printer-led" />
                <span className="printer-status">{sim.paperOut ? "SIN PAPEL" : sim.printing ? "Imprimiendo" : "Libre"}</span>
              </div>
              <div className="printer-out">
                {sim.printing && (
                  <div className="sheet" style={{ height: `${Math.max(8, sim.progress * 100)}%`, borderTopColor: colorOf(sim.printing.proc) }}>
                    <span style={{ color: colorOf(sim.printing.proc) }}>
                      {sim.printing.proc} · {sim.printing.page}/{sim.printing.of}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </Panel>
        </div>

        <Panel
          title="Bandeja de salida"
          subtitle="Páginas en el orden en que salieron"
          actions={
            sim.tray.length > 1 &&
            (mixed ? <span className="badge red">Páginas mezcladas ✗</span> : <span className="badge green">Documentos completos y ordenados ✓</span>)
          }
        >
          <div className="tray">
            {sim.tray.map((pg, i) => (
              <div key={i} className="tray-page" style={{ borderTopColor: colorOf(pg.proc), color: colorOf(pg.proc) }}>
                <span className="tray-n">{i + 1}</span>
                <strong>{pg.proc}</strong>
                <span>
                  {pg.page}/{pg.of}
                </span>
              </div>
            ))}
            {sim.tray.length === 0 && <p className="muted small">Todavía no se imprime nada.</p>}
          </div>
        </Panel>
      </div>

      <div className="grid-2">
        <Panel title="Registro" subtitle="Mensajes del sistema">
          <div className="console light" ref={logRef}>
            {sim.log.map((l) => (
              <div key={l.id} className={`log-${l.kind}`}>
                <span className="log-time">[{l.t.toFixed(1).padStart(5)} s]</span> {l.text}
              </div>
            ))}
            {sim.log.length === 0 && <div className="muted">Pulsa “Enviar a imprimir”.</div>}
          </div>
        </Panel>

        <Panel title="Comparación de corridas" subtitle="Ejecuta los tres modos y compara">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Modo</th>
                <th>Bloqueo promedio</th>
                <th>Bloqueo máximo</th>
                <th>Tiempo total</th>
                <th>Salida</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.n}>
                  <td>{r.n}</td>
                  <td>{MODES.find((m) => m.value === r.mode)?.label}</td>
                  <td>{r.avgBlocked.toFixed(1)} s</td>
                  <td>{r.maxBlocked.toFixed(1)} s</td>
                  <td>{r.total.toFixed(1)} s</td>
                  <td>{r.mixed ? <span className="badge red">mezclada</span> : <span className="badge green">ordenada</span>}</td>
                </tr>
              ))}
              {results.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    Aún no hay corridas completas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {results.length > 0 && (
            <button type="button" className="btn small" onClick={() => setResults([])}>
              Borrar resultados
            </button>
          )}
        </Panel>
      </div>

      <div className="stats-row wide">
        <Stat label="Páginas impresas" value={`${sim.tray.length} / ${sim.procs.reduce((a, p) => a + p.pages, 0)}`} tone="accent" />
        <Stat label="Procesos bloqueados ahora" value={sim.procs.filter((p) => p.status === "blocked").length} tone="red" />
        <Stat label="Procesos trabajando" value={sim.procs.filter((p) => p.status === "working").length} tone="green" />
        <Stat label="Trabajos en cola" value={sim.queue.length} />
      </div>
    </div>
  );
}
