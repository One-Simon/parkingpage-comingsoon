/**
 * Physics primitives for the mosaic engine. Owns Matter `Body` factories, collision filters and
 * the wall layout. Stays pure (no Pixi, no DOM): the orchestrator passes in an `Engine.world` to
 * mutate. By centralizing these primitives, swapping a layout shape (Sourcehive word vs. arbitrary
 * tiles vs. mixed sizes) does not require touching the orchestrator's physics wiring.
 */

import { Bodies, Composite, Constraint } from 'matter-js';
import type { Body, Engine, World } from 'matter-js';
import { TILE_LABEL } from './types.ts';
import type { TileSeed } from './types.ts';

// Physics tunables --------------------------------------------------------------------------------
export const TILE_BODY_DENSITY = 0.003;
export const TILE_INERTIA_SCALE = 4;
export const ENGINE_DELTA_CAP_MS = 1000 / 60;
export const GRAVITY = { x: 0, y: 0.32, scale: 0.00065 };
export const WALL_THICK = 28;

// Collision categories ----------------------------------------------------------------------------
export const TILE_CATEGORY = 0x0002;
export const WALL_CATEGORY = 0x0004;
export const WALL_LABEL = 'physics-wall';
export const FLOOR_LABEL = 'physics-floor';

/** Tile collides with walls AND with other tiles (used at rest / `bound`). */
export const tileFilterFull = () => ({
  category: TILE_CATEGORY,
  mask: TILE_CATEGORY | WALL_CATEGORY,
  group: 0,
});

/** Tile collides only with walls (used during glide / `returning`). */
export const tileFilterWallsOnly = () => ({
  category: TILE_CATEGORY,
  mask: WALL_CATEGORY,
  group: 0,
});

export interface TileBodyOptions {
  /** Filter applied at creation; defaults to walls-only so spawn glide cannot pile up. */
  collisionFilter?: ReturnType<typeof tileFilterFull>;
}

/**
 * Build a square Matter body for a tile at `position` with side length `sizeCss` (CSS px).
 * The body is dynamic; the orchestrator decides phase + tether wiring.
 */
export function createTileBody(
  position: { x: number; y: number },
  sizeCss: number,
  opts: TileBodyOptions = {}
): Body {
  return Bodies.rectangle(position.x, position.y, sizeCss, sizeCss, {
    isStatic: false,
    friction: 0.5,
    frictionAir: 0.014,
    restitution: 0.32,
    density: TILE_BODY_DENSITY,
    label: TILE_LABEL,
    collisionFilter: opts.collisionFilter ?? tileFilterWallsOnly(),
  });
}

export interface ViewportCss {
  cw: number;
  ch: number;
}

/**
 * Build the four perimeter walls (top, left, right, floor) for the canvas viewport. Returns the
 * body references so the caller can tell apart `FLOOR_LABEL` from regular walls in collision
 * callbacks. Walls are removed and rebuilt on resize by the orchestrator.
 */
export function buildWalls(viewport: ViewportCss): { walls: Body[]; floor: Body } {
  const { cw, ch } = viewport;
  const half = WALL_THICK * 0.5;
  const wallOpts = (label: string) => ({
    isStatic: true,
    label,
    collisionFilter: {
      category: WALL_CATEGORY,
      mask: TILE_CATEGORY | WALL_CATEGORY,
      group: 0,
    },
  });

  const top = Bodies.rectangle(cw * 0.5, -half, cw + WALL_THICK * 2, WALL_THICK, wallOpts(WALL_LABEL));
  const left = Bodies.rectangle(-half, ch * 0.5, WALL_THICK, ch + WALL_THICK * 2, wallOpts(WALL_LABEL));
  const right = Bodies.rectangle(cw + half, ch * 0.5, WALL_THICK, ch + WALL_THICK * 2, wallOpts(WALL_LABEL));
  const floor = Bodies.rectangle(cw * 0.5, ch + half, cw + WALL_THICK * 2, WALL_THICK, wallOpts(FLOOR_LABEL));

  return { walls: [top, left, right, floor], floor };
}

export function addAll(world: World, bodies: ReadonlyArray<Body>): void {
  for (const b of bodies) {
    Composite.add(world, b);
  }
}

export function removeAll(world: World, bodies: ReadonlyArray<Body>): void {
  for (const b of bodies) {
    Composite.remove(world, b);
  }
}

// Tether ------------------------------------------------------------------------------------------

export interface TetherOptions {
  stiffness: number;
  damping: number;
}

/** Build the anchor tether for a tile and add it to the world. */
export function createAnchorTether(
  body: Body,
  anchor: { x: number; y: number },
  opts: TetherOptions
): Constraint {
  return Constraint.create({
    bodyA: body,
    pointB: { x: anchor.x, y: anchor.y },
    stiffness: opts.stiffness,
    damping: opts.damping,
    length: 0,
  });
}

export function setTetherStrength(c: Constraint, opts: TetherOptions): void {
  c.stiffness = opts.stiffness;
  c.damping = opts.damping;
}

export function attachTether(engine: Engine, c: Constraint): void {
  Composite.add(engine.world, c);
}

export function detachTether(engine: Engine, c: Constraint): void {
  Composite.remove(engine.world, c);
}

/** Convenience for orchestrators with a `TileSeed` in hand (uses `seed.sizeCss`). */
export function createTileBodyFromSeed(seed: TileSeed, opts: TileBodyOptions = {}): Body {
  return createTileBody({ x: seed.x, y: seed.y }, seed.sizeCss, opts);
}
