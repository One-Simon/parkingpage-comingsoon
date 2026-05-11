/**
 * CustomShapeProvider — accepts a free-form set of tile seeds (any positions, any per-tile size)
 * and returns a {@link TileLayout} the mosaic engine can render. Demonstrates that the engine is
 * decoupled from the SOURCEHIVE shape: any arrangement (a logo, a pattern, mixed sizes, etc.)
 * can be wired in by passing a different provider to {@link BoxesLayer}.
 *
 * Not used by the live page yet; exported so a future caller can swap layouts without touching
 * the orchestrator or any physics/animation/render code.
 */

import type { TileLayout, TileLayoutProvider, TileSeed } from '../types.ts';

export interface CustomTileSpec {
  /** Tile center x, in CSS px. Treated as relative to the chosen alignment origin. */
  x: number;
  /** Tile center y, in CSS px. Treated as relative to the chosen alignment origin. */
  y: number;
  /** Per-tile size in CSS px. Tiles can mix sizes freely. */
  sizeCss: number;
  /** Optional stable id; auto-generated as `T<index>` if omitted. */
  id?: string;
}

export type AlignmentX = 'left' | 'center' | 'right';
export type AlignmentY = 'top' | 'center' | 'bottom';

export interface CustomShapeProviderOptions {
  /** How to anchor the bounding box of the input shape inside the viewport. Default: center/center. */
  alignX?: AlignmentX;
  alignY?: AlignmentY;
  /** Optional uniform scale factor applied after alignment. Default 1. */
  scale?: number;
  /** Optional CSS-px offset added on top of alignment. Default {x:0,y:0}. */
  offset?: { x: number; y: number };
}

export class CustomShapeProvider implements TileLayoutProvider {
  private readonly specs: ReadonlyArray<CustomTileSpec>;
  private readonly alignX: AlignmentX;
  private readonly alignY: AlignmentY;
  private readonly scale: number;
  private readonly offset: { x: number; y: number };

  constructor(specs: ReadonlyArray<CustomTileSpec>, opts: CustomShapeProviderOptions = {}) {
    this.specs = specs;
    this.alignX = opts.alignX ?? 'center';
    this.alignY = opts.alignY ?? 'center';
    this.scale = opts.scale ?? 1;
    this.offset = opts.offset ?? { x: 0, y: 0 };
  }

  compute(viewportCssW: number, viewportCssH: number): TileLayout {
    if (this.specs.length === 0) {
      return {
        tiles: [],
        worldBounds: { minX: 0, minY: 0, maxX: viewportCssW, maxY: viewportCssH },
        defaultCellSizeCss: 0,
      };
    }

    let inMinX = Infinity;
    let inMinY = Infinity;
    let inMaxX = -Infinity;
    let inMaxY = -Infinity;
    for (const s of this.specs) {
      const half = s.sizeCss * 0.5;
      if (s.x - half < inMinX) inMinX = s.x - half;
      if (s.y - half < inMinY) inMinY = s.y - half;
      if (s.x + half > inMaxX) inMaxX = s.x + half;
      if (s.y + half > inMaxY) inMaxY = s.y + half;
    }
    const inW = (inMaxX - inMinX) * this.scale;
    const inH = (inMaxY - inMinY) * this.scale;

    const targetX =
      this.alignX === 'left' ? 0 : this.alignX === 'right' ? viewportCssW - inW : (viewportCssW - inW) * 0.5;
    const targetY =
      this.alignY === 'top' ? 0 : this.alignY === 'bottom' ? viewportCssH - inH : (viewportCssH - inH) * 0.5;

    const dx = targetX - inMinX * this.scale + this.offset.x;
    const dy = targetY - inMinY * this.scale + this.offset.y;

    let sumSize = 0;
    const tiles: TileSeed[] = this.specs.map((s, i) => {
      const sizeCss = s.sizeCss * this.scale;
      sumSize += sizeCss;
      return {
        id: s.id ?? `T${i}`,
        x: s.x * this.scale + dx,
        y: s.y * this.scale + dy,
        sizeCss,
      };
    });

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const t of tiles) {
      const half = t.sizeCss * 0.5;
      if (t.x - half < minX) minX = t.x - half;
      if (t.y - half < minY) minY = t.y - half;
      if (t.x + half > maxX) maxX = t.x + half;
      if (t.y + half > maxY) maxY = t.y + half;
    }

    return {
      tiles,
      worldBounds: { minX, minY, maxX, maxY },
      defaultCellSizeCss: sumSize / Math.max(tiles.length, 1),
    };
  }
}
