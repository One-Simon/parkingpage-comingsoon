import type { Application } from 'pixi.js';

const FALLBACK_CW = 1280;
const FALLBACK_CH = 720;

/** CSS size of the canvas element in layout/picking space (not window.inner*). */
export function getPhysicsViewport(app: Application): { cw: number; ch: number } {
  if (typeof window === 'undefined') {
    return { cw: FALLBACK_CW, ch: FALLBACK_CH };
  }
  const rect = app.canvas.getBoundingClientRect();
  return {
    cw: Math.max(rect.width, 1),
    ch: Math.max(rect.height, 1),
  };
}

/** Pointer `clientX`/`clientY` in the same CSS basis as Matter bodies (canvas-local). */
export function clientToCanvasCss(
  clientX: number,
  clientY: number,
  app: Application
): { x: number; y: number } {
  const rect = app.canvas.getBoundingClientRect();
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}
