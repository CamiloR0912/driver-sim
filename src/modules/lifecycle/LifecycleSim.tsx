import { useEffect, useRef, useState } from "react";
import { ModuleHeader, Panel, Toggle } from "../../components/ui";
import {
  BAUDS,
  CALLBACKS,
  DATA_CAPACITY,
  initialState,
  log,
  proc,
  reading,
  type DrvSimState,
  type IoctlCmd,
  type Proc,
  type ProcName,
} from "./model";

type Step = [delayMs: number, fn: () => void];

/** Ejecuta pasos con retardos para que la audiencia vea cada fase. Bloquea los botones mientras dura. */
function useSequencer() {
  const [busy, setBusy] = useState(false);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const sequence = (steps: Step[]) => {
    setBusy(true);
    let acc = 0;
    for (const [d, fn] of steps) {
      acc += d;
      timers.current.push(window.setTimeout(fn, acc));
    }
    timers.current.push(window.setTimeout(() => setBusy(false), acc + 50));
  };
  const cancel = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setBusy(false);
  };
  return { busy, sequence, cancel };
}

const IOCTL_LABEL: Record<IoctlCmd, string> = {
  SET_BAUD: "MIDEV_SET_BAUD",
  GET_TEMP: "MIDEV_GET_TEMP",
  RESET: "MIDEV_RESET",
};

export default function LifecycleSim() {
  const [s, setS] = useState<DrvSimState>(initialState);
  const [text, setText] = useState("HOLA");
  const [cmd, setCmd] = useState<IoctlCmd>("SET_BAUD");
  const { busy, sequence, cancel } = useSequencer();
  const consoleRef = useRef<HTMLDivElement>(null);

  const mut = (fn: (d: DrvSimState) => void) =>
    setS((prev) => {
      const d = structuredClone(prev);
      fn(d);
      return d;
    });
  const clearActive = (): Step => [450, () => mut((d) => void (d.active = null))];

  useEffect(() => {
    consoleRef.current?.scrollTo({ top: consoleRef.current.scrollHeight, behavior: "smooth" });
  }, [s.log.length]);

  // ---------------- Hardware y sistema ----------------
  const plug = () =>
    sequence([
      [0, () => mut((d) => log(d, "info", "usb 1-1: nuevo dispositivo USB conectado (idVendor=1a86, idProduct=7523)"))],
      [600, () => mut((d) => { d.active = "probe"; log(d, "info", "midev: el ID coincide con la tabla del driver → el kernel llama a probe()"); })],
      [600, () => mut((d) => log(d, "info", "midev: probe(): habilita el dispositivo en el bus y mapea sus registros (MMIO) en 0xfe200000"))],
      [600, () => mut((d) => log(d, "info", "midev: probe(): request_irq(17, midev_isr) OK; reserva memoria con devm_kzalloc()"))],
      [600, () => mut((d) => { d.drv = "bound"; log(d, "ok", "midev: registrado /dev/midev (major 240, minor 0) — listo para usarse"); })],
      clearActive(),
    ]);

  const unplug = () =>
    sequence([
      [0, () => mut((d) => { d.active = "remove"; log(d, "warn", "usb 1-1: dispositivo USB desconectado"); })],
      [700, () =>
        mut((d) => {
          log(d, "info", "midev: remove(): libera la IRQ 17, desmapea los registros y elimina /dev/midev");
          if (d.refs > 0) log(d, "warn", `midev: remove(): quedaban ${d.refs} descriptor(es) abierto(s); sus operaciones devolverán -ENODEV`);
          for (const p of d.procs) {
            if (p.fd === null) continue;
            p.stale = true;
            if (p.sleeping) {
              p.sleeping = false;
              p.last = "read() = -ENODEV";
              log(d, "user", "← read() devuelve -ENODEV (el dispositivo ya no existe)", `Proceso ${p.name}`);
            }
          }
          d.refs = 0;
          d.data = [];
          d.lcd = "";
          d.drv = "unplugged";
        }),
      ],
      clearActive(),
    ]);

  const interrupt = () => {
    if (s.drv === "suspended") {
      mut((d) => log(d, "warn", "midev: el dispositivo está en D3 (suspendido): sus interrupciones están deshabilitadas"));
      return;
    }
    sequence([
      [0, () => mut((d) => { d.irq = true; log(d, "irq", "IRQ 17: el hardware avisa que llegaron datos nuevos"); })],
      [700, () => mut((d) => { d.active = "top"; log(d, "irq", "midev: ISR (top half): lee STATUS=0x01, limpia la bandera, programa el bottom half → IRQ_HANDLED"); })],
      [1000, () =>
        mut((d) => {
          d.irq = false;
          d.active = "bottom";
          const v = reading();
          if (d.data.length >= DATA_CAPACITY) {
            const lost = d.data.shift();
            log(d, "warn", `midev: buffer del driver lleno → se descarta "${lost}" (overflow)`);
          }
          d.data.push(v);
          log(d, "info", `midev: bottom half (workqueue): copia "${v}" del FIFO del hardware al buffer del driver`);
          const sleeper = d.procs.find((p) => p.sleeping);
          if (sleeper) {
            const val = d.data.shift() as string;
            sleeper.sleeping = false;
            sleeper.last = `read() = "${val}"`;
            log(d, "info", `midev: wake_up_interruptible() → despierta al Proceso ${sleeper.name}`);
            log(d, "user", `← despierta: read() devuelve ${val.length + 1} bytes: "${val}\\n"`, `Proceso ${sleeper.name}`);
          }
        }),
      ],
      [700, () => mut((d) => void (d.active = null))],
    ]);
  };

  const sleepInIsr = () =>
    sequence([
      [0, () => mut((d) => { d.irq = true; log(d, "irq", "IRQ 17: el hardware avisa que llegaron datos nuevos"); })],
      [700, () => mut((d) => { d.active = "top"; log(d, "irq", "midev: ISR (top half): lee STATUS=0x01…"); })],
      [800, () => mut((d) => log(d, "warn", "midev: ISR (top half): llama a msleep(10) para esperar al hardware…"))],
      [900, () => mut((d) => { d.panic = true; log(d, "err", "BUG: scheduling while atomic: swapper/0/0/0x00010001"); log(d, "err", "Kernel panic - not syncing: Aiee, killing interrupt handler!"); })],
    ]);

  const suspend = () =>
    sequence([
      [0, () => mut((d) => { d.active = "suspend"; log(d, "pm", "PM: suspendiendo el sistema (suspend to RAM); los procesos se congelan"); })],
      [700, () => mut((d) => log(d, "info", `midev: suspend(): termina la E/S en curso, deshabilita la IRQ 17 y guarda los registros (baud=${d.baud})`))],
      [700, () => mut((d) => { d.drv = "suspended"; log(d, "info", "midev: suspend(): dispositivo en estado D3 (ultra bajo consumo)"); log(d, "pm", "PM: sistema suspendido"); })],
      clearActive(),
    ]);

  const resume = () =>
    sequence([
      [0, () => mut((d) => { d.active = "resume"; log(d, "pm", "PM: reanudando el sistema"); })],
      [700, () => mut((d) => log(d, "info", `midev: resume(): estado D0, restaura los registros (baud=${d.baud}) y reactiva la IRQ 17`))],
      [700, () => mut((d) => { d.drv = "bound"; log(d, "pm", "PM: reanudación completa; los procesos continúan donde estaban"); })],
      clearActive(),
    ]);

  const reboot = () => {
    cancel();
    setS(initialState());
  };

  // ---------------- Llamadas al sistema de cada proceso ----------------
  const who = (n: ProcName) => `Proceso ${n}`;

  const doOpen = (n: ProcName) => {
    if (s.drv === "unplugged") {
      mut((d) => {
        proc(d, n).last = "open() = -ENOENT";
        log(d, "user", '→ open("/dev/midev", O_RDWR) = -ENOENT (no existe el archivo: no hay dispositivo)', who(n));
      });
      return;
    }
    sequence([
      [0, () => mut((d) => { d.active = "open"; log(d, "user", '→ open("/dev/midev", O_RDWR)', who(n)); })],
      [600, () =>
        mut((d) => {
          d.refs++;
          const p = proc(d, n);
          p.fd = 3;
          p.stale = false;
          p.last = "open() = 3";
          log(d, "info", `midev: open(): referencias = ${d.refs}; asigna file->private_data`);
          if (d.refs === 1) log(d, "info", "midev: open(): primer usuario → enciende el reloj del dispositivo");
          log(d, "user", "← devuelve 3 (descriptor de archivo)", who(n));
        }),
      ],
      clearActive(),
    ]);
  };

  const doClose = (n: ProcName) => {
    const p0 = s.procs.find((p) => p.name === n) as Proc;
    if (p0.stale) {
      mut((d) => {
        const p = proc(d, n);
        p.fd = null;
        p.stale = false;
        p.last = "close() = 0";
        log(d, "user", "→ close(3) = 0 (el dispositivo ya se había retirado)", who(n));
      });
      return;
    }
    sequence([
      [0, () => mut((d) => { d.active = "release"; log(d, "user", "→ close(3)", who(n)); })],
      [600, () =>
        mut((d) => {
          d.refs = Math.max(0, d.refs - 1);
          const p = proc(d, n);
          p.fd = null;
          p.last = "close() = 0";
          log(d, "info", `midev: release(): referencias = ${d.refs}`);
          if (d.refs === 0) log(d, "info", "midev: release(): sin usuarios → apaga el reloj (bajo consumo)");
          log(d, "user", "← devuelve 0", who(n));
        }),
      ],
      clearActive(),
    ]);
  };

  const staleError = (n: ProcName, call: string) =>
    mut((d) => {
      proc(d, n).last = `${call} = -ENODEV`;
      log(d, "user", `→ ${call} = -ENODEV (el dispositivo fue retirado)`, who(n));
    });

  const doRead = (n: ProcName) => {
    if (s.procs.find((p) => p.name === n)?.stale) return staleError(n, "read(3)");
    sequence([
      [0, () => mut((d) => { d.active = "read"; log(d, "user", "→ read(3, buf, 64)", who(n)); })],
      [600, () =>
        mut((d) => {
          const p = proc(d, n);
          if (d.data.length) {
            const v = d.data.shift() as string;
            p.last = `read() = "${v}"`;
            log(d, "info", `midev: read(): hay datos → copy_to_user(${v.length + 1} bytes)`);
            log(d, "user", `← devuelve ${v.length + 1} bytes: "${v}\\n"`, who(n));
          } else if (p.nonblock) {
            p.last = "read() = -EAGAIN";
            log(d, "info", "midev: read(): no hay datos y el archivo se abrió con O_NONBLOCK");
            log(d, "user", "← devuelve -EAGAIN (no hay datos, intenta más tarde)", who(n));
          } else {
            p.sleeping = true;
            p.last = "read() … dormido";
            log(d, "info", "midev: read(): no hay datos → wait_event_interruptible(): el proceso se duerme en la wait_queue");
            log(d, "user", "… dormido esperando datos (no consume CPU)", who(n));
          }
        }),
      ],
      clearActive(),
    ]);
  };

  const doWrite = (n: ProcName) => {
    if (s.procs.find((p) => p.name === n)?.stale) return staleError(n, "write(3)");
    const txt = text.slice(0, 16) || " ";
    const call = `write(3, "${txt}", ${txt.length})`;
    if (s.failNext) {
      sequence([
        [0, () => mut((d) => { d.active = "write"; log(d, "user", `→ ${call}`, who(n)); })],
        [600, () => mut((d) => log(d, "info", `midev: write(): copy_from_user(${txt.length} bytes) → registro DATA; espera la confirmación del hardware`))],
        [800, () => mut((d) => log(d, "warn", "midev: timeout esperando ACK (intento 1/3)"))],
        [800, () => mut((d) => log(d, "warn", "midev: timeout esperando ACK (intento 2/3); reintenta tras usleep_range(1000, 2000)"))],
        [800, () => mut((d) => log(d, "warn", "midev: timeout esperando ACK (intento 3/3)"))],
        [700, () => mut((d) => log(d, "err", "midev: el dispositivo no responde → reinicio (reset) del hardware"))],
        [700, () =>
          mut((d) => {
            d.failNext = false;
            d.lcd = "";
            proc(d, n).last = "write() = -ETIMEDOUT";
            log(d, "ok", "midev: reset completado; el dispositivo vuelve a estar operativo");
            log(d, "user", "← devuelve -ETIMEDOUT (tiempo de espera agotado)", who(n));
          }),
        ],
        clearActive(),
      ]);
      return;
    }
    sequence([
      [0, () => mut((d) => { d.active = "write"; log(d, "user", `→ ${call}`, who(n)); })],
      [600, () =>
        mut((d) => {
          d.lcd = txt;
          proc(d, n).last = `write() = ${txt.length}`;
          log(d, "info", `midev: write(): copy_from_user(${txt.length} bytes) → registro DATA; la pantalla muestra "${txt}"`);
          log(d, "user", `← devuelve ${txt.length} (bytes escritos)`, who(n));
        }),
      ],
      clearActive(),
    ]);
  };

  const doIoctl = (n: ProcName) => {
    if (s.procs.find((p) => p.name === n)?.stale) return staleError(n, "ioctl(3)");
    const c = cmd;
    sequence([
      [0, () =>
        mut((d) => {
          d.active = "ioctl";
          const arg = c === "SET_BAUD" ? `, ${BAUDS[(BAUDS.indexOf(d.baud) + 1) % BAUDS.length]}` : c === "GET_TEMP" ? ", &temp" : "";
          log(d, "user", `→ ioctl(3, ${IOCTL_LABEL[c]}${arg})`, who(n));
        }),
      ],
      [600, () =>
        mut((d) => {
          const p = proc(d, n);
          if (c === "SET_BAUD") {
            d.baud = BAUDS[(BAUDS.indexOf(d.baud) + 1) % BAUDS.length];
            log(d, "info", `midev: ioctl(MIDEV_SET_BAUD): reprograma el divisor del UART a ${d.baud} baudios`);
            log(d, "user", "← devuelve 0", who(n));
            p.last = `ioctl() = 0 (baud ${d.baud})`;
          } else if (c === "GET_TEMP") {
            const t = (20 + Math.random() * 8).toFixed(1);
            log(d, "info", "midev: ioctl(MIDEV_GET_TEMP): lee el registro TEMP del sensor");
            log(d, "user", `← devuelve 0; temp = ${t} °C`, who(n));
            p.last = `ioctl() = 0 (${t} °C)`;
          } else {
            d.baud = 9600;
            d.lcd = "";
            log(d, "info", "midev: ioctl(MIDEV_RESET): restablece los valores de fábrica");
            log(d, "user", "← devuelve 0", who(n));
            p.last = "ioctl() = 0 (reset)";
          }
        }),
      ],
      clearActive(),
    ]);
  };

  const doSignal = (n: ProcName) =>
    mut((d) => {
      const p = proc(d, n);
      p.sleeping = false;
      p.last = "read() = -EINTR";
      log(d, "info", "midev: read(): wait_event_interruptible() devuelve -ERESTARTSYS (llegó una señal)");
      log(d, "user", "← read() devuelve -EINTR (interrumpido con Ctrl+C)", who(n));
    });

  const setNonblock = (n: ProcName, v: boolean) => mut((d) => void (proc(d, n).nonblock = v));

  // ---------------- Vista ----------------
  const suspended = s.drv === "suspended";
  const stage = s.drv === "unplugged" ? 0 : suspended ? 3 : s.refs > 0 ? 2 : 1;
  const sleepers = s.procs.filter((p) => p.sleeping).map((p) => p.name);

  return (
    <div className="module">
      <ModuleHeader tag="Secciones 1, 2 y 4 del documento" title="Ciclo de vida de un driver">
        Un driver de carácter llamado <code>midev</code> controla un panel USB con un sensor de temperatura y una pequeña
        pantalla. Conecta el dispositivo, haz llamadas al sistema desde dos procesos y genera interrupciones. Cada
        acción muestra qué función del driver se ejecuta y qué mensajes deja el kernel.
      </ModuleHeader>

      <div className="stage-bar">
        {["Sin dispositivo", "Listo (tras probe)", "En uso (open)", "Suspendido"].map((label, i) => (
          <div key={label} className={`stage ${stage === i ? "active" : ""}`}>
            <span className="stage-n">{i + 1}</span>
            {label}
          </div>
        ))}
      </div>

      <div className="lc-layout">
        {/* Espacio de usuario */}
        <Panel title="Espacio de usuario" subtitle="Procesos que usan /dev/midev" className="lc-user">
          <div className="syscall-args">
            <label className="field">
              <span>Texto para write()</span>
              <input value={text} maxLength={16} onChange={(e) => setText(e.target.value.toUpperCase())} />
            </label>
            <label className="field">
              <span>Comando ioctl()</span>
              <select value={cmd} onChange={(e) => setCmd(e.target.value as IoctlCmd)}>
                <option value="SET_BAUD">MIDEV_SET_BAUD</option>
                <option value="GET_TEMP">MIDEV_GET_TEMP</option>
                <option value="RESET">MIDEV_RESET</option>
              </select>
            </label>
          </div>
          {s.procs.map((p) => {
            const open = p.fd !== null;
            const canCall = open && !p.sleeping && !suspended && !busy;
            const status = suspended
              ? { text: "Congelado (sistema suspendido)", tone: "gray" }
              : p.stale
                ? { text: "Descriptor inválido: dispositivo retirado", tone: "red" }
                : p.sleeping
                  ? { text: "Dormido dentro de read()", tone: "amber" }
                  : open
                    ? { text: "fd = 3 abierto", tone: "green" }
                    : { text: "Sin abrir", tone: "gray" };
            return (
              <div key={p.name} className={`lc-proc ${p.sleeping ? "sleeping" : ""}`}>
                <div className="lc-proc-head">
                  <strong>Proceso {p.name}</strong>
                  <span className={`badge ${status.tone}`}>{status.text}</span>
                </div>
                <div className="syscall-grid">
                  <button type="button" className="btn small" disabled={open || suspended || busy} onClick={() => doOpen(p.name)}>
                    open()
                  </button>
                  <button type="button" className="btn small" disabled={!canCall} onClick={() => doRead(p.name)}>
                    read()
                  </button>
                  <button type="button" className="btn small" disabled={!canCall} onClick={() => doWrite(p.name)}>
                    write()
                  </button>
                  <button type="button" className="btn small" disabled={!canCall} onClick={() => doIoctl(p.name)}>
                    ioctl()
                  </button>
                  <button type="button" className="btn small" disabled={!canCall} onClick={() => doClose(p.name)}>
                    close()
                  </button>
                  <button type="button" className="btn small danger-outline" disabled={!p.sleeping || suspended || busy} onClick={() => doSignal(p.name)}>
                    Ctrl+C
                  </button>
                </div>
                <div className="lc-proc-foot">
                  <Toggle label="O_NONBLOCK" checked={p.nonblock} onChange={(v) => setNonblock(p.name, v)} hint="read() no bloqueante: devuelve -EAGAIN en vez de dormir" />
                  <code className="last-result">{p.last}</code>
                </div>
              </div>
            );
          })}
        </Panel>

        {/* Kernel */}
        <Panel title="Driver midev (kernel)" subtitle="La función que se está ejecutando se ilumina" className="lc-kernel">
          <div className="callback-grid">
            {CALLBACKS.map((c) => (
              <div key={c.id} className={`callback ${s.active === c.id ? "active" : ""} ${c.id === "top" || c.id === "bottom" ? "isr" : ""}`}>
                <code>{c.label}</code>
                <span>{c.desc}</span>
              </div>
            ))}
          </div>
          <div className="kernel-state">
            <div>
              <span className="muted">Referencias abiertas</span>
              <strong>{s.refs}</strong>
            </div>
            <div>
              <span className="muted">wait_queue</span>
              <strong>{sleepers.length ? sleepers.map((n) => `Proceso ${n}`).join(", ") : "vacía"}</strong>
            </div>
          </div>
          <div className="driver-buffer">
            <span className="muted">
              Buffer del driver ({s.data.length}/{DATA_CAPACITY})
            </span>
            <div className="data-chips">
              {Array.from({ length: DATA_CAPACITY }, (_, i) => (
                <span key={i} className={`data-chip ${s.data[i] ? "filled" : ""}`}>
                  {s.data[i] ?? ""}
                </span>
              ))}
            </div>
          </div>
        </Panel>

        {/* Hardware */}
        <Panel title="Hardware" subtitle="Panel USB midev (sensor + pantalla)" className="lc-hw">
          <div className={`device ${s.drv}`}>
            <div className="device-top">
              <span className={`led ${s.drv}`} />
              <span className="device-name">midev</span>
              <span className={`irq-badge ${s.irq ? "on" : ""}`}>IRQ 17</span>
            </div>
            <div className="lcd">{s.drv === "unplugged" ? "" : suspended ? "zz" : s.lcd || "_"}</div>
            <div className="registers">
              <span>STATUS {s.irq ? "0x01" : "0x00"}</span>
              <span>BAUD {s.baud}</span>
              <span>PWR {s.drv === "unplugged" ? "—" : suspended ? "D3" : "D0"}</span>
            </div>
          </div>
          <div className="hw-actions">
            {s.drv === "unplugged" ? (
              <button type="button" className="btn primary" disabled={busy} onClick={plug}>
                Conectar dispositivo
              </button>
            ) : (
              <button type="button" className="btn" disabled={busy || suspended} onClick={unplug}>
                Desconectar dispositivo
              </button>
            )}
            <button type="button" className="btn accent" disabled={busy || s.drv === "unplugged"} onClick={interrupt}>
              ⚡ Llegan datos (interrupción)
            </button>
            {suspended ? (
              <button type="button" className="btn" disabled={busy} onClick={resume}>
                Reanudar el sistema
              </button>
            ) : (
              <button type="button" className="btn" disabled={busy || s.drv === "unplugged"} onClick={suspend}>
                Suspender el sistema
              </button>
            )}
            <Toggle
              label="Fallo de hardware en el próximo write()"
              checked={s.failNext}
              onChange={(v) => mut((d) => void (d.failNext = v))}
              hint="El dispositivo no responderá: verás timeouts, reintentos y un reset"
            />
            <button type="button" className="btn danger" disabled={busy || s.drv !== "bound"} onClick={sleepInIsr}>
              ☠ Dormir dentro de la ISR
            </button>
          </div>
        </Panel>
      </div>

      <Panel
        title="Registro del kernel"
        subtitle="$ dmesg -w"
        actions={
          <button type="button" className="btn small" onClick={() => mut((d) => void (d.log = []))}>
            Limpiar
          </button>
        }
      >
        <div className="console" ref={consoleRef}>
          {s.log.map((l) => (
            <div key={l.id} className={`log-${l.level}`}>
              <span className="log-time">[{l.t.toFixed(6).padStart(12)}]</span> {l.who && <span className="log-who">{l.who}:</span>} {l.text}
            </div>
          ))}
        </div>
      </Panel>

      {s.panic && <PanicScreen onReboot={reboot} />}
    </div>
  );
}

function PanicScreen({ onReboot }: { onReboot: () => void }) {
  return (
    <div className="panic-overlay" role="alertdialog" aria-label="Kernel panic">
      <pre className="panic-trace">{`BUG: scheduling while atomic: swapper/0/0/0x00010001
Modules linked in: midev(O) usbcore
CPU: 0 PID: 0 Comm: swapper/0 Tainted: G           O      6.8.0-so
Call Trace:
 <IRQ>
 dump_stack_lvl+0x48/0x70
 __schedule_bug+0x64/0x80
 __schedule+0x6f2/0x8a0
 schedule+0x3e/0xb0
 schedule_timeout+0x8a/0x150
 msleep+0x2d/0x40
 midev_isr+0x42/0x90 [midev]
 __handle_irq_event_percpu+0x44/0x1a0
 handle_irq_event+0x38/0x80
 </IRQ>
Kernel panic - not syncing: Aiee, killing interrupt handler!
---[ end Kernel panic - not syncing ]---`}</pre>
      <div className="panic-explain">
        <h2>¿Qué pasó?</h2>
        <p>
          La rutina de interrupción llamó a <code>msleep()</code>. Dormir significa que el planificador saca a la tarea
          actual de la CPU y la despierta después, pero una ISR <strong>no es una tarea</strong>: se ejecuta en nombre de
          un evento de hardware, en contexto atómico y con interrupciones deshabilitadas. No hay a quién dormir ni quién
          la despierte, así que el kernel se detiene.
        </p>
        <p>
          <strong>Lo correcto:</strong> la ISR (top half) solo lee el estado, limpia la bandera y programa el trabajo
          pesado en un <strong>bottom half</strong> (workqueue o threaded IRQ), que sí puede dormir. Dentro de la ISR se
          usan spinlocks y <code>GFP_ATOMIC</code>.
        </p>
        <button type="button" className="btn primary" onClick={onReboot}>
          Reiniciar el sistema
        </button>
      </div>
    </div>
  );
}
