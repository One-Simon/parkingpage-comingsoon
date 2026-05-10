/**
 * SOURCEHIVE mosaic: classic 5×7 LCD glyphs, each logical pixel drawn as a 3×3 block of squares
 * (minimum stroke thickness ≈ 3 cells), with gap columns between letters.
 */

import { glyph5x7PlacedInCell } from './dotMatrix5x7.ts';

export const SOURCEHIVE_WORD = 'SOURCEHIVE' as const;

/** Per-letter cell in the master grid (5×7 × 3 block upscale → 15×21). */
export const LETTER_GRID_COLS = 15;
export const LETTER_GRID_ROWS = 21;

/** Empty master-grid columns between letters. */
export const LETTER_GAP_COLS = 2;

/**
 * @deprecated Dot-matrix layout ignores canvas options; kept so callers importing the type stay valid.
 */
export interface RasterMaskOptions {
  readonly supersample?: number;
  readonly lumThreshold?: number;
  readonly fontFamily?: string;
  readonly fontWeight?: string;
  readonly widthFill?: number;
}

export const DEFAULT_RASTER_OPTIONS: RasterMaskOptions = Object.freeze({});

/** Fraction of physics/canvas width used for the mosaic span (larger ⇒ bigger squares + wider word). */
export const MOSAIC_WIDTH_FRAC = 0.9;

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function getMasterGridCssSize(word: string): { totalCols: number; totalRows: number } {
  const n = word.length;
  const totalCols = n * LETTER_GRID_COLS + Math.max(0, n - 1) * LETTER_GAP_COLS;
  return { totalCols, totalRows: LETTER_GRID_ROWS };
}

export function cellSizeFromMasterCols(cssW: number, totalCols: number): number {
  return (cssW * MOSAIC_WIDTH_FRAC) / Math.max(totalCols, 1);
}

export function gridToCells(grid: boolean[][]): Array<{ gx: number; gy: number }> {
  const cells: Array<{ gx: number; gy: number }> = [];
  for (let gy = 0; gy < grid.length; gy++) {
    const row = grid[gy];
    if (!row) continue;
    for (let gx = 0; gx < row.length; gx++) {
      if (row[gx]) cells.push({ gx, gy });
    }
  }
  return cells;
}

/**
 * Assemble `word` into one boolean matrix: 5×7 glyphs block-upscaled 3× per cell + gap columns.
 */
export function masterMaskForWord(
  word: string,
  _options: Partial<RasterMaskOptions> = {}
): boolean[][] {
  const upper = word.toUpperCase();
  const { totalCols, totalRows } = getMasterGridCssSize(upper);

  const grid: boolean[][] = Array.from({ length: totalRows }, () => Array(totalCols).fill(false));

  let col = 0;
  for (let i = 0; i < upper.length; i++) {
    const ch = upper[i] ?? '?';
    const sub = glyph5x7PlacedInCell(ch, LETTER_GRID_COLS, LETTER_GRID_ROWS);
    for (let ry = 0; ry < totalRows; ry++) {
      const row = grid[ry]!;
      const subRow = sub[ry]!;
      for (let rx = 0; rx < LETTER_GRID_COLS; rx++) {
        row[col + rx] = subRow[rx] ?? false;
      }
    }
    col += LETTER_GRID_COLS;
    if (i < upper.length - 1) {
      col += LETTER_GAP_COLS;
    }
  }

  return grid;
}
