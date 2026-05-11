import type { Application } from 'pixi.js';
import { cssPixelsToPixiFactors } from './coords.ts';

/** Last pointer sample in Pixi render space; (-1,-1) when inactive. */
export type PointerSample = Readonly<{ x: number; y: number }>;

export class PointerBridge {
  static readonly inactive: PointerSample = Object.freeze({ x: -1, y: -1 });
  latest: PointerSample = PointerBridge.inactive;

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

    window.addEventListener('pointermove', onMove, { passive: true });
    this.app.canvas.addEventListener('pointerleave', onLeave, { passive: true });

    this.disposers.push(
      () => window.removeEventListener('pointermove', onMove),
      () => this.app.canvas.removeEventListener('pointerleave', onLeave)
    );
  }

  dispose() {
    while (this.disposers.length) {
      const d = this.disposers.pop();
      d?.();
    }
    this.latest = PointerBridge.inactive;
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

function cssToPixi(clientX: number, clientY: number, app: Application): PointerSample | null {
  const { rect, sx, sy } = cssPixelsToPixiFactors(app);
  const xCss = clientX - rect.left;
  const yCss = clientY - rect.top;
  if (xCss < 0 || yCss < 0 || xCss > rect.width || yCss > rect.height) {
    return null;
  }
  return Object.freeze({ x: xCss * sx, y: yCss * sy });
}
