import type { ReactNode } from "react";

export function ModuleHeader({ tag, title, children }: { tag: string; title: string; children: ReactNode }) {
  return (
    <header className="module-header">
      <span className="module-tag">{tag}</span>
      <h1>{title}</h1>
      <p>{children}</p>
    </header>
  );
}

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className = "",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <div className="panel-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p className="panel-sub">{subtitle}</p>}
          </div>
          {actions && <div className="panel-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export type Tone = "default" | "accent" | "green" | "orange" | "red" | "amber";

export function Stat({ label, value, tone = "default", hint }: { label: string; value: ReactNode; tone?: Tone; hint?: string }) {
  return (
    <div className={`stat tone-${tone}`} title={hint}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={o.value === value ? "active" : ""}
          onClick={() => onChange(o.value)}
          disabled={disabled}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PlayControls({
  running,
  onToggle,
  onStep,
  onReset,
  speed,
  onSpeed,
  done = false,
  playLabel = "Reproducir",
}: {
  running: boolean;
  onToggle: () => void;
  onStep?: () => void;
  onReset: () => void;
  speed: number;
  onSpeed: (v: number) => void;
  done?: boolean;
  playLabel?: string;
}) {
  return (
    <div className="play-controls">
      <button type="button" className="btn primary" onClick={onToggle} disabled={done && !running}>
        {running ? "❚❚ Pausar" : `▶ ${playLabel}`}
      </button>
      {onStep && (
        <button type="button" className="btn" onClick={onStep} disabled={running || done}>
          Paso ▸|
        </button>
      )}
      <button type="button" className="btn" onClick={onReset}>
        ↺ Reiniciar
      </button>
      <label className="speed">
        Velocidad
        <input type="range" min={0.25} max={4} step={0.25} value={speed} onChange={(e) => onSpeed(Number(e.target.value))} />
        <span>{speed}×</span>
      </label>
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format = (v) => String(v),
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  disabled?: boolean;
}) {
  return (
    <label className="slider">
      <span className="slider-top">
        <span>{label}</span>
        <strong>{format(value)}</strong>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="toggle" title={hint}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" />
      <span>{label}</span>
    </label>
  );
}

export function Callout({ tone = "accent", title, children }: { tone?: Tone; title?: string; children: ReactNode }) {
  return (
    <div className={`callout tone-${tone}`}>
      {title && <strong>{title}</strong>}
      <div>{children}</div>
    </div>
  );
}
