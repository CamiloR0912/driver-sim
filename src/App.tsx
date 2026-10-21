import { useEffect, useState, type ComponentType } from "react";
import { IconBuffer, IconChip, IconDisk, IconHome, IconPrinter, type IconProps } from "./components/Icons";
import Home, { type ModuleId } from "./modules/Home";
import LifecycleSim from "./modules/lifecycle/LifecycleSim";
import BufferingSim from "./modules/buffering/BufferingSim";
import SpoolingSim from "./modules/spooling/SpoolingSim";
import DiskSim from "./modules/disk/DiskSim";

type TabId = "home" | ModuleId;

const TABS: { id: TabId; label: string; icon: ComponentType<IconProps> }[] = [
  { id: "home", label: "Inicio", icon: IconHome },
  { id: "lifecycle", label: "Ciclo de vida", icon: IconChip },
  { id: "buffering", label: "Buffering", icon: IconBuffer },
  { id: "spooling", label: "Spooling", icon: IconPrinter },
  { id: "disk", label: "Planificación de disco", icon: IconDisk },
];

const initialTab = (): TabId => {
  const h = window.location.hash.slice(1);
  return TABS.some((t) => t.id === h) ? (h as TabId) : "home";
};

export default function App() {
  const [tab, setTabState] = useState<TabId>(initialTab);
  const setTab = (id: TabId) => {
    setTabState(id);
    history.replaceState(null, "", `#${id}`);
  };

  useEffect(() => {
    const onHash = () => setTabState(initialTab());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <IconChip width={22} height={22} />
          </span>
          <div>
            <strong>DriverSim</strong>
            <span>Drivers y E/S</span>
          </div>
        </div>
        <div className="bus">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={`nav-item ${tab === id ? "active" : ""}`}
              aria-current={tab === id ? "page" : undefined}
              onClick={() => setTab(id)}
            >
              <Icon />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div className="sidebar-foot">Sistemas Operativos · Equipo 3</div>
      </nav>

      {/* Los módulos permanecen montados para no perder su estado al cambiar de pestaña */}
      <main className="content">
        <div hidden={tab !== "home"}>
          <Home onOpen={setTab} />
        </div>
        <div hidden={tab !== "lifecycle"}>
          <LifecycleSim />
        </div>
        <div hidden={tab !== "buffering"}>
          <BufferingSim />
        </div>
        <div hidden={tab !== "spooling"}>
          <SpoolingSim />
        </div>
        <div hidden={tab !== "disk"}>
          <DiskSim />
        </div>
      </main>
    </div>
  );
}
