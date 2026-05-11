/**
 * Typed transition table for {@link TilePhase}. Replaces ad-hoc string assignments scattered
 * across the mosaic pipeline so any illegal jump (e.g. `returning` → `falling`) is caught
 * immediately. `latticeGlide` is treated as an orthogonal flag, not a phase, matching how the
 * rest of the codebase reads it (a `bound` tile may be in a kinematic glide back to its anchor).
 *
 * In dev (`import.meta.env.DEV`) illegal transitions throw so they surface in the console; in
 * production they degrade to a single `console.warn` and are still committed (visible misbehavior
 * is preferable to a hard crash on a paying user's screen).
 */

import type { TilePhase, TileRecord } from './types.ts';

const ALLOWED: Readonly<Record<TilePhase, ReadonlyArray<TilePhase>>> = Object.freeze({
  bound: ['bound', 'falling', 'returning'],
  falling: ['bound', 'falling', 'returning'],
  returning: ['bound', 'returning'],
});

declare const __DEV__: boolean | undefined;

function isDev(): boolean {
  try {
    if (typeof __DEV__ === 'boolean') return __DEV__;
  } catch {
    /* fallthrough */
  }
  try {
    return Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);
  } catch {
    return false;
  }
}

/**
 * Move `tile` to `next`. `reason` is included in any error/log so test runs and bug reports can
 * pinpoint the offending callsite. Always assign — even when illegal in prod — so the rest of the
 * code can defensively continue.
 */
export function transitionPhase(tile: TileRecord, next: TilePhase, reason: string): void {
  const prev = tile.phase;
  if (prev === next) return;
  const allowed = ALLOWED[prev];
  if (!allowed || !allowed.includes(next)) {
    const msg = `[mosaic] illegal phase transition ${prev} -> ${next} (${reason}) on tile ${tile.id}`;
    if (isDev()) {
      throw new Error(msg);
    }
    console.warn(msg);
  }
  tile.phase = next;
}
