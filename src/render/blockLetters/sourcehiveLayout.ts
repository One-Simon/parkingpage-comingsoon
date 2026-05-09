/** 5×7 cell masks (`#` filled, `.` empty). Each row same width. */
const GLYPHS: Record<string, readonly string[]> = {
  S: ['.###.', '#...#', '#....', '.##..', '....#', '#...#', '.###.'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  R: ['####.', '#...#', '#...#', '####.', '#..#.', '#...#', '#...#'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '.#.#.', '.#.#.', '..#..'],
};

export const SOURCEHIVE_WORD = 'SOURCEHIVE' as const;

export type SourcehiveCell = Readonly<{ gx: number; gy: number }>;

export const LETTER_GAP_COLS = 1;

export function sourcehiveGridCells(word: string = SOURCEHIVE_WORD): SourcehiveCell[] {
  const cells: SourcehiveCell[] = [];
  let col = 0;
  const upper = word.toUpperCase();
  for (let li = 0; li < upper.length; li++) {
    const ch = upper[li] ?? '';
    const mask = GLYPHS[ch];
    if (!mask) continue;
    const letterW = mask[0]?.length ?? 0;
    const letterH = mask.length;
    for (let ry = 0; ry < letterH; ry++) {
      const row = mask[ry];
      if (!row) continue;
      for (let rx = 0; rx < letterW; rx++) {
        if (row[rx] === '#') {
          cells.push({ gx: col + rx, gy: ry });
        }
      }
    }
    col += letterW + LETTER_GAP_COLS;
  }
  return cells;
}

export interface SourcehiveLayoutWorld {
  readonly centersCss: ReadonlyArray<Readonly<{ x: number; y: number }>>;
  readonly cellSizeCss: number;
  readonly gridWidth: number;
  readonly gridHeight: number;
}

export function layoutSourcehiveInViewport(
  cssW: number,
  cssH: number,
  cellSizeCss: number,
  fractionY = 0.38
): SourcehiveLayoutWorld {
  const cells = sourcehiveGridCells();
  if (cells.length === 0) {
    return { centersCss: [], cellSizeCss, gridWidth: 0, gridHeight: 0 };
  }
  let maxGx = 0;
  let maxGy = 0;
  for (const c of cells) {
    maxGx = Math.max(maxGx, c.gx);
    maxGy = Math.max(maxGy, c.gy);
  }
  const gridW = maxGx + 1;
  const gridH = maxGy + 1;
  const worldW = gridW * cellSizeCss;
  const worldH = gridH * cellSizeCss;
  const originX = (cssW - worldW) * 0.5;
  const originY = cssH * fractionY - worldH * 0.5;

  const centersCss = cells.map((c) => ({
    x: originX + (c.gx + 0.5) * cellSizeCss,
    y: originY + (c.gy + 0.5) * cellSizeCss,
  }));

  return { centersCss, cellSizeCss, gridWidth: gridW, gridHeight: gridH };
}
