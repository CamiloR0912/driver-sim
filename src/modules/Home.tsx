import type { ComponentType } from "react";
import type { IconProps } from "../components/Icons";
import { IconBuffer, IconChip, IconDisk, IconPrinter } from "../components/Icons";

export type ModuleId = "lifecycle" | "buffering" | "spooling" | "disk";

const CARDS: { id: ModuleId; icon: ComponentType<IconProps>; title: string; text: string; question?: string }[] = [
  {
    id: "lifecycle",
    icon: IconChip,
    title: "Ciclo de vida del driver",
    text: "probe, open, read, write, ioctl, close, suspend/resume y remove. Interrupciones con top half y bottom half, procesos que duermen en una wait_queue y manejo de errores con timeouts y reintentos.",
    question: "¿Por qué no se puede dormir dentro de una ISR?",
  },
  {
    id: "buffering",
    icon: IconBuffer,
    title: "Buffering",
    text: "Buffer simple, doble y circular entre un dispositivo y un proceso. Cambia las velocidades y provoca overflow y underflow.",
  },
  {
    id: "spooling",
    icon: IconPrinter,
    title: "Spooling",
    text: "Varios procesos imprimen en una sola impresora. Compara el acceso directo, el acceso exclusivo y el spooling.",
    question: "¿Qué problema resuelve el spooling en una impresora compartida?",
  },
  {
    id: "disk",
    icon: IconDisk,
    title: "Planificación de disco",
    text: "FCFS, SSTF, SCAN, C-SCAN, LOOK y C-LOOK con animación del cabezal, cálculo paso a paso y comparación de los seis.",
    question: "¿Cuál conviene: FCFS, SSTF o SCAN?",
  },
];

export default function Home({ onOpen }: { onOpen: (id: ModuleId) => void }) {
  return (
    <div className="module home">
      <header className="hero">
        <span className="module-tag">Sistemas Operativos · Bloque 3 · Equipo 3</span>
        <h1>Simulador de drivers y gestión de E/S</h1>
        <p>
          Cuatro simuladores interactivos para acompañar la exposición. Cada uno corresponde a una parte del documento y
          ayuda a responder una de las preguntas guía.
        </p>
      </header>
      <div className="home-grid">
        {CARDS.map(({ id, icon: Icon, title, text, question }) => (
          <button key={id} type="button" className="home-card" onClick={() => onOpen(id)}>
            <span className="home-icon">
              <Icon width={26} height={26} />
            </span>
            <h2>{title}</h2>
            <p>{text}</p>
            {question && <span className="home-question">{question}</span>}
            <span className="home-go">Abrir simulador</span>
          </button>
        ))}
      </div>
    </div>
  );
}
