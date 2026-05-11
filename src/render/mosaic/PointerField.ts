/**
 * Radial repulsion force field driven by a pressed pointer. Pure-ish: the orchestrator owns the
 * Matter mouse state and the tile list; this module owns the **shape** of the force (radius,
 * falloff, speed scaling, per-phase strength). Surface distance is computed against the actual
 * body so any tile size / shape works without changes here.
 */

import { Body, Vertices } from 'matter-js';
import type { Body as BodyType } from 'matter-js';
import type { TileRecord } from './types.ts';

// Tunables ----------------------------------------------------------------------------------------
/** Minimum field radius in CSS px; orchestrator may widen with a per-cell-size multiplier. */
export const POINTER_REPULSE_RADIUS_CSS = 69.12;
/** Peak repulsion force (Matter units); scaled by falloff inside the disc. */
export const POINTER_REPULSE_FORCE = 0.00112;
/** Falling tiles still feel the field, but at this fraction of the bound-tile push. */
export const POINTER_REPULSE_FALLING_MULT = 0.4;
/** Blend: linear+quadratic falloff so mid-disc push is stronger than pure edge². */
export const POINTER_REPULSE_FALLOFF_LINEAR = 0.3;
/**
 * When a cell's hull intersects the disc but its center lies outside radius R, still push outward
 * using at least this normalized edge term (0–1).
 */
export const POINTER_FIELD_HULL_OVERLAP_MIN_EDGE = 0.175;

/** At-rest scaling so a stationary press still gets full radial falloff. */
export const POINTER_FIELD_SPEED_AT_REST_MULT = 1;
export const POINTER_FIELD_SPEED_CAP_MULT = 2.4;
/** Cursor speed (px/ms) at which the cap multiplier is reached. */
export const POINTER_FIELD_SPEED_REF_PX_PER_MS = 0.72;

// Pure helpers ------------------------------------------------------------------------------------

/** Closest point on a tile body's hull (including child parts) to the pointer, with distance. */
export function tileClosestSurfacePointToPointer(
  body: BodyType,
  px: number,
  py: number
): { qx: number; qy: number; dist: number } {
  let bestD2 = Infinity;
  let qx = body.position.x;
  let qy = body.position.y;
  const considerVertices = (verts: ReadonlyArray<{ x: number; y: number }>) => {
    const n = verts.length;
    for (let i = 0; i < n; i++) {
      const va = verts[i]!;
      const vb = verts[(i + 1) % n]!;
      const ex = vb.x - va.x;
      const ey = vb.y - va.y;
      const len2 = ex * ex + ey * ey || 1e-9;
      let t = ((px - va.x) * ex + (py - va.y) * ey) / len2;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const cx = va.x + ex * t;
      const cy = va.y + ey * t;
      const dx = cx - px;
      const dy = cy - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        qx = cx;
        qy = cy;
      }
    }
  };
  if (body.parts.length > 1) {
    for (let p = 1; p < body.parts.length; p++) considerVertices(body.parts[p]!.vertices);
  } else {
    considerVertices(body.vertices);
  }
  return { qx, qy, dist: Math.sqrt(Math.max(bestD2, 0)) };
}

/** True if the pointer (treated as a point) lies inside the body hull. `radius` reserved for a
 *  future fat-finger expansion of the test; currently the disc is enforced by the caller via
 *  `dCenter < R` / `dSurf < R` checks. */
export function pointerDiscHitsBody(
  pt: { x: number; y: number },
  _radius: number,
  body: BodyType
): boolean {
  const start = body.parts.length > 1 ? 1 : 0;
  for (let p = start; p < body.parts.length; p++) {
    if (Vertices.contains(body.parts[p]!.vertices, pt)) return true;
  }
  if (start === 0 && Vertices.contains(body.vertices, pt)) return true;
  return false;
}

// Cursor speed sampler ---------------------------------------------------------------------------

export class CursorSpeedSampler {
  private prevX = NaN;
  private prevY = NaN;

  /** Returns cursor speed in px/ms for the latest sample. `dt` should already be clamped. */
  sample(px: number, py: number, dtMs: number): number {
    const dtSafe = Math.max(dtMs, 1e-6);
    let speed = 0;
    if (Number.isFinite(this.prevX) && Number.isFinite(this.prevY)) {
      speed = Math.hypot(px - this.prevX, py - this.prevY) / dtSafe;
    }
    this.prevX = px;
    this.prevY = py;
    return speed;
  }

  reset(): void {
    this.prevX = NaN;
    this.prevY = NaN;
  }
}

// Field application -------------------------------------------------------------------------------

export interface PointerFieldContext {
  px: number;
  py: number;
  radius: number;
  cursorSpeedPxPerMs: number;
  draggedBody: BodyType | null;
  /** `performance.now()` snapshot to stamp `lastBoxInteractPerf` on affected tiles. */
  now: number;
}

/**
 * Apply the radial pointer-repulsion force to all eligible tiles. A tile is eligible when it is
 * dynamic, not currently grabbed, not in `returning` phase, not in a kinematic glide, and either
 * its surface or its center sits within the field radius (or the disc visually overlaps the hull).
 */
export function applyPointerField(
  tiles: ReadonlyArray<TileRecord>,
  ctx: PointerFieldContext
): void {
  const { px, py, radius: R, cursorSpeedPxPerMs, draggedBody, now } = ctx;
  const speedT = Math.min(1, cursorSpeedPxPerMs / POINTER_FIELD_SPEED_REF_PX_PER_MS);
  const speedFactor =
    POINTER_FIELD_SPEED_AT_REST_MULT +
    (POINTER_FIELD_SPEED_CAP_MULT - POINTER_FIELD_SPEED_AT_REST_MULT) * speedT;

  for (const r of tiles) {
    const b = r.body;
    const { qx, qy, dist: dSurf } = tileClosestSurfacePointToPointer(b, px, py);
    const dCenter = Math.hypot(b.position.x - px, b.position.y - py);

    const inField = dSurf < R || dCenter < R || pointerDiscHitsBody({ x: px, y: py }, R, b);
    if (!inField) continue;
    if (b.isStatic) continue;
    if (draggedBody === b) continue;
    if (r.phase === 'returning') continue;
    if (r.latticeGlide) continue;

    let nx: number;
    let ny: number;
    let dEff: number;
    if (dSurf >= 1e-5) {
      dEff = dSurf;
      nx = (qx - px) / dSurf;
      ny = (qy - py) / dSurf;
    } else if (dCenter >= 1e-4) {
      dEff = dCenter;
      nx = (b.position.x - px) / dCenter;
      ny = (b.position.y - py) / dCenter;
    } else {
      continue;
    }

    let edge = 1 - Math.min(dEff, R) / R;
    if (edge <= 0) edge = POINTER_FIELD_HULL_OVERLAP_MIN_EDGE;
    const falloff =
      POINTER_REPULSE_FALLOFF_LINEAR * edge + (1 - POINTER_REPULSE_FALLOFF_LINEAR) * edge * edge;
    const phaseMult = r.phase === 'falling' ? POINTER_REPULSE_FALLING_MULT : 1;
    const mag = POINTER_REPULSE_FORCE * falloff * speedFactor * phaseMult;
    Body.applyForce(b, b.position, { x: nx * mag, y: ny * mag });
    r.lastBoxInteractPerf = now;
  }
}
