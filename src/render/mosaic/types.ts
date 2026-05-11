/**
 * Mosaic shape-agnostic types. The mosaic engine consumes these contracts only — anything that
 * produces tile anchor positions (SourceHive word, custom shape, single hex grid, …) implements
 * {@link TileLayoutProvider} and the rest of the pipeline does not change.
 */

import type { Body, Constraint as ConstraintType } from 'matter-js';
import type { Graphics } from 'pixi.js';

/** Matter `body.label` for one mosaic tile (was `LETTER_LABEL`). */
export const TILE_LABEL = 'mosaic-tile';

/**
 * One tile's anchor position and rest size in CSS pixels. `id` is stable across resizes so
 * relayout can rebuild the anchor cache without losing per-tile state.
 */
export interface TileSeed {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly sizeCss: number;
}

/** Output of a {@link TileLayoutProvider}: where the tiles want to be at rest. */
export interface TileLayout {
  readonly tiles: ReadonlyArray<TileSeed>;
  readonly worldBounds: {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
  };
  /**
   * Cell size used as the default for spawn scatter range, pointer-field radius defaults and
   * any module-global threshold that does not have a per-tile equivalent (so a uniform layout
   * still has a single representative cell size).
   */
  readonly defaultCellSizeCss: number;
}

/** Pluggable layout source. Pure function of viewport size in CSS pixels. */
export interface TileLayoutProvider {
  compute(viewportCssW: number, viewportCssH: number): TileLayout;
}

/**
 * Tile lifecycle. `latticeGlide` is treated as an orthogonal kinematic flag, not a phase, to
 * match the existing implementation (a `bound` tile can be in glide returning to its anchor).
 */
export type TilePhase = 'bound' | 'falling' | 'returning';

/**
 * Per-tile runtime state. Replaces the legacy `LetterRecord`; gx/gy grid coordinates are gone in
 * favor of the stable `id`.
 */
export interface TileRecord {
  /** Stable across resizes; primary key in the anchor cache. */
  id: string;
  /** Per-tile size (CSS px). For uniform layouts this matches `TileLayout.defaultCellSizeCss`. */
  sizeCss: number;

  body: Body;
  g: Graphics;
  anchorX: number;
  anchorY: number;
  phase: TilePhase;

  floorDwellMs: number;
  touchingFloor: boolean;
  touchingSupport: boolean;
  /** Ms spent nearly motionless while off-anchor; kicks homing when stuck. */
  offAnchorStillMs: number;
  /** `falling` and not on floor: accumulates low-speed air stuck time → homing. */
  airStuckMs: number;
  /** `bound` after tether handoff: nearly home & still → slow settle. */
  tetherSettleMs: number;
  /**
   * Wall-clock of the last pointer-session interaction with this tile. Tether/homing strength
   * ramps 0→1 over `POST_INTERACT_HOME_RESUME_MS`. `-1` = never; full strength.
   */
  lastBoxInteractPerf: number;
  /** Active only in `bound`; removed for `falling` / `returning`. */
  anchorTether: ConstraintType | null;

  // Glide segment (Hermite curve) -------------------------------------------------------------
  latticeGlide: boolean;
  latticeGlideElapsedMs: number;
  latticeGlideStartX: number;
  latticeGlideStartY: number;
  latticeGlideStartVx: number;
  latticeGlideStartVy: number;
  latticeGlideDurationMs: number;
  /** True for the appear animation: switches the curve to the spawn-tuned target speed. */
  latticeGlideIsSpawn: boolean;

  // Stuck/respawn detectors -------------------------------------------------------------------
  boundStuckMs: number;
  boundLowMotionMs: number;
  /** `bound` only: off-anchor + quiet body. */
  quietOffHomeMs: number;
  /** Dynamic tile off lattice anchor: accumulates toward a hard respawn. */
  offAnchorRespawnMs: number;
  /** Prior anchor distance for stuck detection; `-1` = unset. */
  boundStuckLastDist: number;
}
