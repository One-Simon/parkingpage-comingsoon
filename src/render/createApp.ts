import { Application } from 'pixi.js';
import { invalidateCachedCanvasRect } from './canvasRect.ts';

export type PixiHost = HTMLElement;

export async function createPixiApp(host: PixiHost) {
  const app = new Application();
  await app.init({
    resizeTo: typeof window !== 'undefined' ? window : host,
    autoDensity: true,
    preference: 'webgl',
    backgroundColor: 0x020203,
    antialias: true,
    resolution: typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1,
  });

  host.innerHTML = '';
  host.appendChild(app.canvas);
  // First layout read after mount; avoids a 0×0 cache snapshot before the canvas is painted.
  void app.canvas.getBoundingClientRect();
  invalidateCachedCanvasRect(app);

  const destroy = () => {
    app.ticker.destroy();
    app.destroy(true);
  };

  return { app, destroy };
}
