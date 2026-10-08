import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * Ejecuta `onTick(dt)` en cada cuadro de animación mientras `running` sea true.
 * `dt` está en segundos y se limita a 0.1 s para evitar saltos al volver a la ventana.
 */
export function useLoop(running: boolean, onTick: (dt: number) => void) {
  const cb = useRef(onTick);
  useLayoutEffect(() => {
    cb.current = onTick;
  });

  useEffect(() => {
    if (!running) return;
    let last = performance.now();
    let id = requestAnimationFrame(function frame(now) {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      cb.current(dt);
      id = requestAnimationFrame(frame);
    });
    return () => cancelAnimationFrame(id);
  }, [running]);
}
