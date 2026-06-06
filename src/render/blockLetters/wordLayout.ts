import {
  cellSizeFromMasterCols,
  gridToCells,
  MOSAIC_WORD,
  masterMaskForWord,
} from './rasterWordMask.ts';

type WordTile = Readonly<{
  gx: number;
  gy: number;
  x: number;
  y: number;
}>;

interface WordLayoutWorld {
  /** Filled cells in row-major order from the raster (stable for matching across resizes). */
  readonly tiles: ReadonlyArray<WordTile>;
  readonly cellSizeCss: number;
  readonly gridWidth: number;
  readonly gridHeight: number;
}

/**
 * Build mosaic layout: dot matrix + gaps; horizontal span = `MOSAIC_WIDTH_FRAC` of `cssW`;
 * `cellSizeCss` = span / total master columns.
 */
export function layoutWordInViewport(
  cssW: number,
  cssH: number,
  fractionY = 0.38
): WordLayoutWorld {
  const mask = masterMaskForWord(MOSAIC_WORD);
  const gridColumns = mask[0]?.length ?? 0;
  const gridRows = mask.length;
  const cellSizeCss = cellSizeFromMasterCols(cssW, gridColumns);

  const cells = gridToCells(mask);
  if (cells.length === 0) {
    return { tiles: [], cellSizeCss, gridWidth: gridColumns, gridHeight: gridRows };
  }

  const worldW = gridColumns * cellSizeCss;
  const worldH = gridRows * cellSizeCss;
  const originX = (cssW - worldW) * 0.5;
  const originY = cssH * fractionY - worldH * 0.5;

  const tiles = cells.map((c) => ({
    gx: c.gx,
    gy: c.gy,
    x: originX + (c.gx + 0.5) * cellSizeCss,
    y: originY + (c.gy + 0.5) * cellSizeCss,
  }));

  return { tiles, cellSizeCss, gridWidth: gridColumns, gridHeight: gridRows };
}
