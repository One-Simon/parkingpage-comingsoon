import type { Application } from 'pixi.js';

/** Map CSS-pixel canvas geometry to Pixi render-buffer units. */
export function cssPixelsToPixiFactors(app: Application) {
  const el = app.canvas;
  const rect = el.getBoundingClientRect();
  const rw = Math.max(app.renderer.width, 1);
  const rh = Math.max(app.renderer.height, 1);
  const cw = Math.max(rect.width, 1);
  const ch = Math.max(rect.height, 1);
  return {
    rect,
    sx: rw / cw,
    sy: rh / ch,
    cssWidth: cw,
    cssHeight: ch,
  };
}
