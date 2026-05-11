/**
 * Cubic Hermite tile-return animation. The orchestrator owns when a glide starts/ends; this
 * module owns the math (curve evaluation + duration selection) and the tunables. Thresholds are
 * keyed on the per-tile `sizeCss` so layouts with mixed cell sizes work without changes here.
 */

import type { TileRecord } from './types.ts';

// ===== Tunables =================================================================================

/** Multiplier on `sizeCss`: enter glide when within this many tile widths of the anchor. */
export const LATTICE_GLIDE_ENTER_MULT = 6.5;
/** Multiplier on `sizeCss`: abort glide if the body drifts farther than this from anchor. */
export const LATTICE_GLIDE_ABORT_MULT = 7.15;
/** Multiplier on `sizeCss`: snap to anchor when within this distance. */
export const LATTICE_GLIDE_SNAP_MULT = 0.032;
/** Hard ceiling on a single glide segment's wall-clock. */
export const LATTICE_GLIDE_MAX_MS = 4800;

// Post-release glide tuning ----------------------------------------------------------------------
export const LATTICE_GLIDE_TARGET_SPEED_PX_PER_S = 80;
export const LATTICE_GLIDE_MIN_DURATION_MS = 600;
export const LATTICE_GLIDE_MAX_DURATION_MS = 3200;

// Spawn (appear animation) glide tuning ----------------------------------------------------------
export const LATTICE_GLIDE_SPAWN_TARGET_SPEED_PX_PER_S = 160;
export const LATTICE_GLIDE_SPAWN_MIN_DURATION_MS = 380;
export const LATTICE_GLIDE_SPAWN_MAX_DURATION_MS = 1600;

/** Multiplier on `sizeCss`: distance at which `returning` hands off to glide. */
export const LATTICE_GLIDE_RETURNING_HANDOFF_MULT = 5.45;

// ===== Pure helpers =============================================================================

/** Glide segment thresholds resolved against a per-tile size. */
export function glideThresholds(sizeCss: number): {
  enterPx: number;
  abortPx: number;
  snapPx: number;
} {
  return {
    enterPx: Math.max(2, sizeCss * LATTICE_GLIDE_ENTER_MULT),
    abortPx: Math.max(3.5, sizeCss * LATTICE_GLIDE_ABORT_MULT),
    snapPx: Math.max(0.55, sizeCss * LATTICE_GLIDE_SNAP_MULT),
  };
}

/** Pick a duration for a glide segment given start velocity and remaining distance. */
export function chooseGlideDurationMs(
  startDistPx: number,
  outwardSpeedPxPerMs: number,
  isSpawn: boolean
): number {
  const targetPxPerS = isSpawn
    ? LATTICE_GLIDE_SPAWN_TARGET_SPEED_PX_PER_S
    : LATTICE_GLIDE_TARGET_SPEED_PX_PER_S;
  const minDur = isSpawn ? LATTICE_GLIDE_SPAWN_MIN_DURATION_MS : LATTICE_GLIDE_MIN_DURATION_MS;
  const maxDur = isSpawn ? LATTICE_GLIDE_SPAWN_MAX_DURATION_MS : LATTICE_GLIDE_MAX_DURATION_MS;
  // Cubic Hermite naturally overshoots by ~ v0·D/6 in the outward case; budget that.
  const overshootBudgetPx = Math.max(0, outwardSpeedPxPerMs) * 280;
  const desired = ((startDistPx + overshootBudgetPx) / targetPxPerS) * 1000;
  return Math.min(maxDur, Math.max(minDur, desired));
}

/**
 * Evaluate the cubic Hermite glide curve at normalized t∈[0,1] given start position, anchor
 * position, start velocity (px/ms) and total segment duration (ms). End velocity is fixed to 0
 * so the tile lands gently on the anchor.
 */
export function evaluateGlide(
  t: number,
  start: { x: number; y: number },
  anchor: { x: number; y: number },
  startVel: { vx: number; vy: number },
  durationMs: number
): { x: number; y: number; easedAngleDecay: number } {
  const tt = t * t;
  const ttt = tt * t;
  const h00 = 2 * ttt - 3 * tt + 1;
  const h10 = ttt - 2 * tt + t;
  const h01 = -2 * ttt + 3 * tt;
  const m0x = startVel.vx * durationMs;
  const m0y = startVel.vy * durationMs;
  return {
    x: h00 * start.x + h10 * m0x + h01 * anchor.x,
    y: h00 * start.y + h10 * m0y + h01 * anchor.y,
    easedAngleDecay: h01,
  };
}

/** Reset all per-tile glide segment fields. */
export function resetGlideState(r: TileRecord): void {
  r.latticeGlideElapsedMs = 0;
  r.latticeGlideStartX = r.body.position.x;
  r.latticeGlideStartY = r.body.position.y;
  r.latticeGlideStartVx = 0;
  r.latticeGlideStartVy = 0;
  r.latticeGlideDurationMs = 0;
  r.latticeGlideIsSpawn = false;
}
