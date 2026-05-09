import { createPixiApp } from './render/createApp.ts';
import { BoxesLayer } from './render/layers/BoxesLayer.ts';
import { DotField } from './render/layers/DotField.ts';
import { PointerBridge } from './render/pointerBridge.ts';

/** Boot Pixi + Matter + dot field; returns teardown function. */
export async function bootstrapSimulation(pixHost: HTMLElement): Promise<() => Promise<void>> {
  const { app, destroy: destroyPixi } = await createPixiApp(pixHost);

  const pointerBridge = new PointerBridge(app);
  pointerBridge.start();

  const dotField = new DotField(app.renderer.width, app.renderer.height);
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

  const tickerCb = (): void => {
    if (stopped) return;
    const dtMs = Math.min(app.ticker.deltaMS, 32);
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
