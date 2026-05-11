import { Application } from 'pixi.js';

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

  const destroy = () => {
    app.ticker.destroy();
    app.destroy(true);
  };

  return { app, destroy };
}
