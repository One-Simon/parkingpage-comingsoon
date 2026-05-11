/**
 * Cached canvas `DOMRect`. Pointer move / hit testing happens many times per second; calling
 * `getBoundingClientRect()` on every event triggers layout work in the browser. We cache the
 * rect and invalidate it on `resize` and via a `ResizeObserver` so the cache stays correct
 * while the per-event call drops to a Map lookup.
 *
 * One `Application` ⇒ one cache entry. Rect snapshots are returned by reference; callers MUST
 * NOT mutate the returned object.
 */

import type { Application } from 'pixi.js';

interface RectSnapshot {
  left: number;
  top: number;
  width: number;
  height: number;
}

const ZERO_RECT: RectSnapshot = Object.freeze({ left: 0, top: 0, width: 1, height: 1 });

const cache = new WeakMap<Application, CachedRect>();

class CachedRect {
  private snapshot: RectSnapshot = ZERO_RECT;
  private resizeObserver: ResizeObserver | null = null;
  private dirty = true;
  private readonly app: Application;

  constructor(app: Application) {
    this.app = app;
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.dirty = true;
      });
      try {
        this.resizeObserver.observe(app.canvas);
      } catch {
        /* canvas may not be in the DOM yet */
      }
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.invalidate, { passive: true });
      window.addEventListener('scroll', this.invalidate, { passive: true });
    }
  }

  invalidate = (): void => {
    this.dirty = true;
  };

  read(): RectSnapshot {
    if (this.dirty) {
      const r = this.app.canvas.getBoundingClientRect();
      this.snapshot = {
        left: r.left,
        top: r.top,
        width: Math.max(r.width, 1),
        height: Math.max(r.height, 1),
      };
      this.dirty = false;
    }
    return this.snapshot;
  }

  dispose(): void {
    if (this.resizeObserver) {
      try {
        this.resizeObserver.disconnect();
      } catch {
        /* no-op */
      }
      this.resizeObserver = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.invalidate);
      window.removeEventListener('scroll', this.invalidate);
    }
  }
}

function getOrCreate(app: Application): CachedRect {
  let entry = cache.get(app);
  if (!entry) {
    entry = new CachedRect(app);
    cache.set(app, entry);
  }
  return entry;
}

/** Returns the most recently observed canvas rect (creates the cache entry on first use). */
export function getCachedCanvasRect(app: Application): RectSnapshot {
  return getOrCreate(app).read();
}

/** Force the cache to re-read on the next access; call on manual layout transitions. */
export function invalidateCachedCanvasRect(app: Application): void {
  cache.get(app)?.invalidate();
}

/** Tear down the observer when an Application is destroyed. */
export function disposeCachedCanvasRect(app: Application): void {
  const entry = cache.get(app);
  if (!entry) return;
  entry.dispose();
  cache.delete(app);
}
