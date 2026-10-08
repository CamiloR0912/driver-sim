# DriverSim — Simulador de drivers y gestión de E/S

Simulador interactivo para la exposición del **Bloque 3 (Controladores y gestión de E/S)** de Sistemas Operativos.
Hecho con Tauri 2, React 19 y TypeScript. Toda la simulación corre en el frontend.

## Módulos

| Módulo | Qué muestra | Pregunta guía |
|---|---|---|
| **Ciclo de vida** | Driver de carácter `midev`: probe, open, read, write, ioctl, close, suspend/resume, remove. Interrupciones (top half y bottom half), procesos que duermen en la `wait_queue`, `O_NONBLOCK`, Ctrl+C (`-EINTR`), fallo de hardware con timeouts, reintentos y reset, y un *kernel panic* al dormir dentro de la ISR. | ¿Por qué no se puede dormir en una ISR? |
| **Buffering** | Buffer simple, doble y circular entre un dispositivo y un proceso; overflow, underflow, ráfagas y control de flujo. | — |
| **Spooling** | Impresora compartida en tres modos: acceso directo (páginas mezcladas), acceso exclusivo (procesos bloqueados) y spooling (cola en disco). Tabla para comparar las corridas. | ¿Qué problema resuelve el spooling? |
| **Planificación de disco** | FCFS, SSTF, SCAN, C-SCAN, LOOK y C-LOOK con animación del cabezal, tabla paso a paso y comparación de los seis. Trae cargado el ejemplo del documento (cola 98, 183, 37, 122, 14, 124, 65, 67; cabezal en 53). | ¿Cuál conviene: FCFS, SSTF o SCAN? |

## Cómo ejecutarlo

```bash
npm install          # solo la primera vez
npm run tauri dev    # abre la aplicación de escritorio
```

Para verlo solo en el navegador: `npm run dev` y abrir http://localhost:1420.
Se puede abrir un módulo directamente con `#lifecycle`, `#buffering`, `#spooling` o `#disk` al final de la URL.

Para generar el instalador: `npm run tauri build` (queda en `src-tauri/target/release/bundle/`).

## Estructura

```
src/
  App.tsx                     barra lateral y navegación
  styles.css                  estilos
  components/                 controles reutilizables e íconos
  hooks/useLoop.ts            bucle de animación (requestAnimationFrame)
  modules/
    Home.tsx
    lifecycle/                model.ts (estado y registro) + LifecycleSim.tsx
    buffering/                model.ts (simulación) + BufferingSim.tsx
    spooling/                 model.ts (simulación) + SpoolingSim.tsx
    disk/                     algorithms.ts (los 6 algoritmos) + DiskSim.tsx
```
