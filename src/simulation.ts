import { createPixiApp } from './render/createApp.ts';
import { BoxesLayer } from './render/layers/BoxesLayer.ts';
import { DotField, loadDotFieldFaviconTexture } from './render/layers/DotField.ts';
import { PointerBridge } from './render/pointerBridge.ts';

/** Boot Pixi + Matter + dot field; returns teardown function. */
export async function bootstrapSimulation(pixHost: HTMLElement): Promise<() => Promise<void>> {
  const { app, destroy: destroyPixi } = await createPixiApp(pixHost);

  const pointerBridge = new PointerBridge(app);
  pointerBridge.start();

  const faviconTexture = await loadDotFieldFaviconTexture();
  const dotField = new DotField(app.renderer.width, app.renderer.height, faviconTexture);
  app.stage.sortableChildren = true;
  dotField.container.zIndex = 0;

  const boxesLayer = new BoxesLayer(app);
  boxesLayer.root.zIndex = 1;

  app.stage.addChild(dotField.container);
  app.stage.addChild(boxesLayer.root);

  let stopped = false;
  let layoutFrame = 0 as number | undefined;

  const resizeDots = () => {
    dotField.resize(app.renderer.width, app.renderer.height);
  };

  const onViewportResize = () => {
    if (layoutFrame) cancelAnimationFrame(layoutFrame);
    layoutFrame = requestAnimationFrame(() => {
      resizeDots();
    });
  };
  window.addEventListener('resize', onViewportResize, { passive: true });

  /** Single dt cap shared between physics and dot-field; covers occasional 30 Hz ticks while
   *  preventing tab-switch backlogs (which can deliver multi-second `deltaMS` spikes). */
  const DT_CAP_MS = 32;

  const tickerCb = (): void => {
    if (stopped) return;
    const dtMs = Math.min(app.ticker.deltaMS, DT_CAP_MS);
    boxesLayer.update(dtMs);
    dotField.tick(
      dtMs / 1000,
      pointerBridge.latest,
      app.renderer.width,
      app.renderer.height
    );
  };

  app.ticker.add(tickerCb);

  return async () => {
    if (stopped) return;
    stopped = true;

    window.removeEventListener('resize', onViewportResize);
    if (layoutFrame) cancelAnimationFrame(layoutFrame);

    pointerBridge.dispose();
    app.ticker.remove(tickerCb);

    dotField.dispose();
    boxesLayer.dispose();

    destroyPixi();
  };
}
