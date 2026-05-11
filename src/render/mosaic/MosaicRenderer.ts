/**
 * Pixi rendering for the mosaic. Each tile already owns its `Graphics` (created during spawn /
 * respawn); this module owns the per-frame draw call. By taking `sizeCss` from the per-tile
 * record (rather than a module-global cell size) the renderer transparently handles layouts that
 * mix sizes — the side length is whatever the layout provider declared on the seed.
 */

import type { TileRecord } from './types.ts';

export interface RenderScale {
  /** CSS-px → Pixi-px factor on X. */
  sx: number;
  /** CSS-px → Pixi-px factor on Y. */
  sy: number;
}

const FILL_COLOR = 0xd4892d;
const FILL_ALPHA = 0.94;
const STROKE_COLOR = 0x2a1508;
const STROKE_ALPHA = 0.78;

/**
 * Redraw every tile's Graphics for the current frame. Body angle and position drive transform;
 * `sizeCss` per tile drives the rectangle dimensions so mixed-size layouts work out of the box.
 */
export function drawTiles(tiles: ReadonlyArray<TileRecord>, scale: RenderScale): void {
  const { sx, sy } = scale;
  const minStrokeWidth = Math.max(1, sx);
  for (const r of tiles) {
    const b = r.body;
    const g = r.g;
    g.rotation = b.angle;
    const px = Number.isFinite(b.position.x) ? b.position.x : r.anchorX;
    const py = Number.isFinite(b.position.y) ? b.position.y : r.anchorY;
    g.position.set(px * sx, py * sy);
    const side = r.sizeCss;
    g.clear();
    g.rect(-side * 0.5 * sx, -side * 0.5 * sy, side * sx, side * sy);
    g.fill({ color: FILL_COLOR, alpha: FILL_ALPHA });
    g.stroke({ width: minStrokeWidth, color: STROKE_COLOR, alpha: STROKE_ALPHA });
  }
}
