/**
 * SOURCEHIVE word layout exposed as a {@link TileLayoutProvider}. Wraps the existing
 * `layoutSourcehiveInViewport` so the mosaic engine no longer depends on the SourceHive shape
 * directly. Output is bit-for-bit identical to the legacy code path; ids are derived from the
 * grid coordinates (`L<gx>,<gy>`) so they stay stable across resizes.
 */

import { layoutSourcehiveInViewport } from '../../blockLetters/sourcehiveLayout.ts';
import type { TileLayout, TileLayoutProvider, TileSeed } from '../types.ts';

export interface SourcehiveProviderOptions {
  /** Vertical placement of the mosaic (fraction of viewport height). Matches `LAYOUT_FRAC_Y`. */
  fractionY?: number;
}

export class SourcehiveProvider implements TileLayoutProvider {
  private readonly fractionY: number;

  constructor(opts: SourcehiveProviderOptions = {}) {
    this.fractionY = opts.fractionY ?? 0.38;
  }

  compute(viewportCssW: number, viewportCssH: number): TileLayout {
    const layout = layoutSourcehiveInViewport(viewportCssW, viewportCssH, this.fractionY);
    const cellSizeCss = layout.cellSizeCss;
    const tiles: TileSeed[] = layout.tiles.map((t) => ({
      id: `L${t.gx},${t.gy}`,
      x: t.x,
      y: t.y,
      sizeCss: cellSizeCss,
    }));

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const half = cellSizeCss * 0.5;
    for (const t of tiles) {
      if (t.x - half < minX) minX = t.x - half;
      if (t.y - half < minY) minY = t.y - half;
      if (t.x + half > maxX) maxX = t.x + half;
      if (t.y + half > maxY) maxY = t.y + half;
    }
    if (!Number.isFinite(minX)) {
      minX = 0;
      minY = 0;
      maxX = viewportCssW;
      maxY = viewportCssH;
    }

    return {
      tiles,
      worldBounds: { minX, minY, maxX, maxY },
      defaultCellSizeCss: cellSizeCss,
    };
  }
}
