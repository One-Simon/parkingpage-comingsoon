import type { Application } from 'pixi.js';
import { getCachedCanvasRect } from './canvasRect.ts';

/** Map CSS-pixel canvas geometry to Pixi render-buffer units. */
export function cssPixelsToPixiFactors(app: Application) {
  const rect = getCachedCanvasRect(app);
  const rw = Math.max(app.renderer.width, 1);
  const rh = Math.max(app.renderer.height, 1);
  const cw = rect.width;
  const ch = rect.height;
  return {
    rect,
    sx: rw / cw,
    sy: rh / ch,
    cssWidth: cw,
    cssHeight: ch,
  };
}
