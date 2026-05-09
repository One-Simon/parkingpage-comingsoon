import type { Application } from 'pixi.js';
import { cssPixelsToPixiFactors } from './coords.ts';

/** Last pointer sample in Pixi render space; (-1,-1) when inactive. */
export type PointerSample = Readonly<{ x: number; y: number }>;

export class PointerBridge {
  static readonly inactive: PointerSample = Object.freeze({ x: -1, y: -1 });
  latest: PointerSample = PointerBridge.inactive;
  /** True while pointer down started on canvas (not used by dot field directly). */
  pointerDownOnCanvas = false;

  private disposers: Array<() => void> = [];

  private readonly app: Application;
  private readonly uiRootSelector: string;

  constructor(app: Application, uiRootSelector = '#ui-root') {
    this.app = app;
    this.uiRootSelector = uiRootSelector;
  }

  start() {
    const onMove = (ev: PointerEvent) => {
      if (shouldIgnoreInteraction(ev.target, this.uiRootSelector)) {
        return;
      }
      const p = cssToPixi(ev.clientX, ev.clientY, this.app);
      if (p) {
        this.latest = p;
      }
    };

    const onLeave = () => {
      this.latest = PointerBridge.inactive;
    };

    const onDown = (ev: PointerEvent) => {
      if (shouldIgnoreInteraction(ev.target, this.uiRootSelector)) {
        return;
      }
      if (canvasHit(ev, this.app)) {
        this.pointerDownOnCanvas = true;
      }
    };

    const onUpOrCancel = () => {
      this.pointerDownOnCanvas = false;
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('pointerup', onUpOrCancel, { passive: true });
    window.addEventListener('pointercancel', onUpOrCancel, { passive: true });
    this.app.canvas.addEventListener('pointerleave', onLeave, { passive: true });

    this.disposers.push(
      () => window.removeEventListener('pointermove', onMove),
      () => window.removeEventListener('pointerdown', onDown),
      () => window.removeEventListener('pointerup', onUpOrCancel),
      () => window.removeEventListener('pointercancel', onUpOrCancel),
      () => this.app.canvas.removeEventListener('pointerleave', onLeave)
    );
  }

  dispose() {
    while (this.disposers.length) {
      const d = this.disposers.pop();
      d?.();
    }
    this.latest = PointerBridge.inactive;
    this.pointerDownOnCanvas = false;
  }
}

function shouldIgnoreInteraction(target: EventTarget | null, selector: string): boolean {
  if (!(target instanceof Node)) return false;
  try {
    return Boolean(
      (target as Element).closest?.(
        `${selector} input, ${selector} textarea, ${selector} button, ${selector} a`
      )
    );
  } catch {
    return false;
  }
}

function canvasHit(ev: PointerEvent, app: Application) {
  const { rect } = cssPixelsToPixiFactors(app);
  const x = ev.clientX - rect.left;
  const y = ev.clientY - rect.top;
  return x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
}

export function cssToPixi(clientX: number, clientY: number, app: Application): PointerSample | null {
  const { rect, sx, sy } = cssPixelsToPixiFactors(app);
  const xCss = clientX - rect.left;
  const yCss = clientY - rect.top;
  if (xCss < 0 || yCss < 0 || xCss > rect.width || yCss > rect.height) {
    return null;
  }
  return Object.freeze({ x: xCss * sx, y: yCss * sy });
}
