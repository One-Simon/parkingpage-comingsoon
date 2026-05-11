/**
 * Settling, heal and respawn tunables. Co-locates the constants that drive `tryReleaseFromMotion`,
 * `tryForceReassembleIfStill`, `maybeForceSnapBoundWhenStuck`, `maybeSettleBoundWhenQuietOffHome`,
 * `maybeCommitBoundToLocked`, `recoverBrokenBodies`, `respawnTileAtAnchor` and
 * `maybeRespawnTileIfOffAnchorTooLong` so the orchestrator no longer carries them at module
 * scope. Pure helpers are exposed so the orchestrator's per-tile loop can be assembled from
 * shape-agnostic pieces — every multiplier accepts a per-tile `sizeCss` argument.
 */

import type { TileRecord } from './types.ts';

// Tether strength ramp ----------------------------------------------------------------------------
export const TETHER_STIFFNESS_NEAR = 0.00042;
export const TETHER_STIFFNESS_FAR = 0.0024;
export const TETHER_DAMPING_NEAR = 0.0012;
export const TETHER_DAMPING_FAR = 0.0028;
export const TETHER_STIFFNESS_RELAX = 0.00003;
export const TETHER_DAMPING_RELAX = 0.00065;
export const TETHER_RELAX_RADIUS_MULT = 0.52;
export const TETHER_RAMP_DIST_MULT = 10.25;

// Hit/release thresholds --------------------------------------------------------------------------
export const RELEASE_DIST_MULT = 29;
export const HIT_RELEASE_SPEED = 1.15;

// Coast / homing ramp -----------------------------------------------------------------------------
export const POST_INTERACT_HOME_RESUME_MS = 560;
export const RELEASE_COAST_MS = 420;

// Bound-stuck / lock-at-anchor --------------------------------------------------------------------
export const BOUND_LOCK_DIST_MULT = 0.055;
export const BOUND_LOCK_SPEED_MAX = 0.088;
export const BOUND_LOCK_ANG_MAX = 0.035;
export const BOUND_LOCK_STILL_MS = 1450;
export const BOUND_STUCK_SPD_MAX = 0.16;
export const BOUND_STUCK_ANG_MAX = 0.055;
export const BOUND_STUCK_DIST_EPS = 0.35;
export const BOUND_STUCK_PROGRESS_MIN = 0.09;
export const BOUND_STUCK_MS = 560;
export const BOUND_STUCK_LOW_MOTION_SPD = 0.062;
export const BOUND_STUCK_LOW_MOTION_ANG = 0.048;
export const BOUND_STUCK_LOW_MOTION_MS = 340;

// Off-anchor heal / respawn -----------------------------------------------------------------------
export const QUIET_OFF_HOME_MS = 300;
export const QUIET_OFF_HOME_SPD = 0.15;
export const QUIET_OFF_HOME_ANG = 0.058;
export const QUIET_OFF_HOME_MAX_DIST_MULT = 9.5;
export const OFF_ANCHOR_RESPAWN_MS = 22000;

// Falling / floor ---------------------------------------------------------------------------------
export const RETURN_DELAY_MS = 480;
export const REST_SPEED_MAX = 0.52;
export const SUPPORT_DY_MIN = 0.55;
export const HOMING_LAMBDA = 0.5;
export const HOMING_TETHER_HANDOFF_CELL_MULT = 4.2;
export const HOMING_TETHER_HANDOFF_RELEASE_FRAC = 0.096;
export const HOMING_SLOW_OUTER_FRAC = 0.22;
export const HOMING_NEAR_STEP_SCALE = 0.4;
export const BOUND_ANGLE_DAMP = 0.94;

// Bounds enforcement ------------------------------------------------------------------------------
export const BOUNDS_PAD_CSS = 3;

// ===== Pure helpers =============================================================================

/** Easing curve for "how strong should homing be right now" given last interaction time. */
export function homingResumeEase(lastInteractPerf: number, nowPerf: number): number {
  if (lastInteractPerf < 0) return 1;
  const elapsed = nowPerf - lastInteractPerf;
  if (elapsed <= 0) return 0;
  if (elapsed >= POST_INTERACT_HOME_RESUME_MS) return 1;
  const t = elapsed / POST_INTERACT_HOME_RESUME_MS;
  return t * t * (3 - 2 * t);
}

export interface TetherStrength {
  stiffness: number;
  damping: number;
}

/**
 * Resolve the tether strength a `bound` tile should currently use, based on distance from anchor
 * and (1) the per-tile size, (2) the post-interaction homing ease.
 */
export function tetherStrengthAt(
  distFromAnchorPx: number,
  sizeCss: number,
  homingEase: number
): TetherStrength {
  const tetherRampDist = TETHER_RAMP_DIST_MULT * sizeCss;
  const t = Math.min(1, distFromAnchorPx / Math.max(tetherRampDist, 1e-6));
  const baseStiff = TETHER_STIFFNESS_NEAR + (TETHER_STIFFNESS_FAR - TETHER_STIFFNESS_NEAR) * t;
  const baseDamp = TETHER_DAMPING_NEAR + (TETHER_DAMPING_FAR - TETHER_DAMPING_NEAR) * t;
  const stiffness =
    TETHER_STIFFNESS_RELAX + (baseStiff - TETHER_STIFFNESS_RELAX) * homingEase;
  const damping = TETHER_DAMPING_RELAX + (baseDamp - TETHER_DAMPING_RELAX) * homingEase;
  return { stiffness, damping };
}

/** True when the body is essentially at rest at its anchor and should be soft-locked there. */
export function isBoundLockedAtAnchor(r: TileRecord): boolean {
  const dx = r.body.position.x - r.anchorX;
  const dy = r.body.position.y - r.anchorY;
  const dist = Math.hypot(dx, dy);
  if (dist > BOUND_LOCK_DIST_MULT * r.sizeCss) return false;
  const speed = Math.hypot(r.body.velocity.x, r.body.velocity.y);
  if (speed > BOUND_LOCK_SPEED_MAX) return false;
  if (Math.abs(r.body.angularVelocity) > BOUND_LOCK_ANG_MAX) return false;
  return r.tetherSettleMs >= BOUND_LOCK_STILL_MS;
}
