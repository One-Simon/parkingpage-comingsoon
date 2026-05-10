import {
  Bodies,
  Body,
  Composite,
  Constraint,
  Detector,
  Engine,
  Events,
  Mouse,
  MouseConstraint,
  Sleeping,
  Vertices,
} from 'matter-js';
import type { Constraint as ConstraintType } from 'matter-js';
import type { IEvent, IEventCollision, MouseConstraint as Manipulator } from 'matter-js';
import { Container, Graphics } from 'pixi.js';
import type { Application } from 'pixi.js';
import { layoutSourcehiveInViewport } from '../blockLetters/sourcehiveLayout.ts';
import { cssPixelsToPixiFactors } from '../coords.ts';
import { clientToCanvasCss, getPhysicsViewport } from '../physicsViewport.ts';

/**
 * Minimum pointer “fat finger” radius in CSS px; scales with {@link BoxesLayer.cellSizeCss}.
 * Used for wake-on-press and for grabbing bodies before Matter’s point-only vertex test runs.
 */
const POINTER_INTERACTION_RADIUS_CSS = 34;

/**
 * When true: any Matter `MouseConstraint` attachment to mosaic cells is cleared before/after each
 * {@link Engine.update} so only pointer repulsion/tethers are felt. Off by default — direct hits on a
 * tile still grab via {@link MouseConstraint}.
 */
const BOX_POINTER_GRAB_DISABLED = false;

const WALL_THICK = 28;
/** Matter `body.label` for one mosaic **box** (grid cell). Word “letter” in the filename is historical. */
const LETTER_LABEL = 'sourcehive-cell';
const LETTER_CATEGORY = 0x0002;
const WALL_CATEGORY = 0x0004;
const WALL_LABEL = 'physics-wall';
const FLOOR_LABEL = 'physics-floor';
const LAYOUT_FRAC_Y = 0.38;

const LETTER_BODY_DENSITY = 0.003;
const MATTER_INERTIA_SCALE = 4;
const ENGINE_DELTA_CAP_MS = 1000 / 60;

/** If one dynamic letter hits another at least this fast, the struck tile transitions to `falling`. */
const HIT_RELEASE_SPEED = 1.15;

const GRAVITY = { x: 0, y: 0.32, scale: 0.00065 };

/** Tight cursor follow; raise toward 1 if drag still lags. */
const MOUSE_CONSTRAINT_STIFFNESS = 0.999;
const MOUSE_CONSTRAINT_DAMPING = 0.06;

/**
 * When true, removes neighbor anchor tethers under the pick disc while dragging (pile clearance).
 * Default off: prefer cutting only when a future force-based rule warrants it.
 */
const NEIGHBOR_TETHER_CUT_WHILE_DRAG = false;

/**
 * When true, `pointerup` re-runs `ensureAnchorTether` for every `bound` dynamic. When false, field
 * off is minimal and per-tile logic / drag-end handles repair.
 */
const POINTER_UP_ENSURE_ANCHOR_TETHER_FOR_ALL_BOUND = false;

/** Beyond this multiple of cell size from anchor, the tether is removed and the tile `fall`s. */
const RELEASE_DIST_MULT = 29;

/**
 * Stiffness/damping ramp uses this distance (× cell), not {@link RELEASE_DIST_MULT}. Larger values
 * keep pull weaker until the tile is closer to its slot (“contained” tether).
 */
const TETHER_RAMP_DIST_MULT = 10.25;

/**
 * After primary pointer release on the canvas, homing and tether strength ease from 0 to full over
 * this duration for each box (see {@link LetterRecord.lastBoxInteractPerf}).
 */
const POST_INTERACT_HOME_RESUME_MS = 560;
/**
 * After pointer release, tiles ride their field-imparted velocity for this long with the tether
 * very weak (`boxHomingEase` ramps 0→1 over this window). Once it reaches 1, the kinematic
 * ease-in-out glide takes over for the controlled return. Longer = more momentum carry.
 */
const RELEASE_COAST_MS = 420;
/**
 * Anchor tether: soft near the lattice rest pose; strength ramps with distance using
 * {@link TETHER_RAMP_DIST_MULT} (not break distance {@link RELEASE_DIST_MULT}).
 */
const TETHER_STIFFNESS_NEAR = 0.00042;
const TETHER_STIFFNESS_FAR = 0.0024;
const TETHER_DAMPING_NEAR = 0.0012;
const TETHER_DAMPING_FAR = 0.0028;

/**
 * Within this many × cell size from anchor, blend tether toward “relaxed” so collisions can
 * re-seat tiles against neighbors without the constraint fighting the pile.
 */
const TETHER_RELAX_RADIUS_MULT = 0.52;
const TETHER_STIFFNESS_RELAX = 0.00003;
const TETHER_DAMPING_RELAX = 0.00065;

/** Snap when nearly home; smaller = stricter “in place”. */
const REASSEMBLY_DIST_EPS_MULT = 0.04;

/** If this long at (near) rest but still off anchor, start homing (no instant snap). */
const REASSEMBLY_STILL_MS = 720;
/** Near-anchor “bound” tiles: must be almost motionless to accumulate still time. */
const REASSEMBLY_SPEED_MAX_BOUND = 0.16;
const REASSEMBLY_ANG_MAX = 0.045;

/** Falling, never hits floor: low-speed dwell → same homing path as floor return. */
const FALLING_AIR_STUCK_MS = 680;
const FALLING_AIR_STUCK_SPEED = 0.2;

/**
 * Homing switches to dynamic `bound` + tether only inside this band from the anchor — a small
 * fraction of the break span, capped by a few cells (not the whole `RELEASE_DIST_MULT` range).
 */
const HOMING_TETHER_HANDOFF_CELL_MULT = 4.2;
const HOMING_TETHER_HANDOFF_RELEASE_FRAC = 0.096;

/** Inside this fraction of release distance, ease kinematic step rate (outer band than handoff). */
const HOMING_SLOW_OUTER_FRAC = 0.22;
/** Minimum fraction of full step when deep inside {@link HOMING_SLOW_OUTER_FRAC} band. */
const HOMING_NEAR_STEP_SCALE = 0.4;

/** After handoff to tether: this long nearly still and very close → commit to locked lattice. */
const BOUND_LOCK_DIST_MULT = 0.055;
const BOUND_LOCK_SPEED_MAX = 0.088;
const BOUND_LOCK_ANG_MAX = 0.035;
const BOUND_LOCK_STILL_MS = 1450;

/**
 * `bound` + tether (or near slot without glide): no progress toward anchor while nearly still →
 * kinematic snap to lattice via {@link settleLetterAtAnchor} (bypasses physics pile-up).
 */
const BOUND_STUCK_SPD_MAX = 0.16;
const BOUND_STUCK_ANG_MAX = 0.055;
const BOUND_STUCK_DIST_EPS = 0.35;
const BOUND_STUCK_PROGRESS_MIN = 0.09;
const BOUND_STUCK_MS = 560;
/** `bound` + tether: velocity almost zero while not finishing homing → snap sooner than plateau. */
const BOUND_STUCK_LOW_MOTION_SPD = 0.062;
const BOUND_STUCK_LOW_MOTION_ANG = 0.048;
const BOUND_STUCK_LOW_MOTION_MS = 340;

/**
 * `bound`: off lattice anchor, not moving meaningfully → {@link BoxesLayer.settleLetterAtAnchor} after
 * this long. Catches jams (e.g. on another letter) without tether / distance-plateau rules.
 */
const QUIET_OFF_HOME_MS = 300;
const QUIET_OFF_HOME_SPD = 0.15;
const QUIET_OFF_HOME_ANG = 0.058;
/** Max anchor error (× cell) for this shortcut — only when already near the mosaic. */
const QUIET_OFF_HOME_MAX_DIST_MULT = 9.5;

/**
 * Last resort: dynamic tile stays off its lattice anchor this long → replace Matter body + Pixi
 * graphics with a fresh locked tile at the current layout anchor.
 */
const OFF_ANCHOR_RESPAWN_MS = 22000;

/**
 * Final approach: kinematic lerp toward anchor, **walls-only** letter–letter filter so the glider
 * cannot drive itself into a neighbor; no anchor tether. Canceled by user grab / large anchor mismatch.
 * Wider entry band means tiles switch to smooth slide earlier in the post-press return so neighboring
 * tethered tiles don't fight each other through collision contacts.
 */
const LATTICE_GLIDE_ENTER_MULT = 6.5;
/**
 * Target speed (CSS px / s) used to derive the duration of an ease-in-out glide segment from its
 * start distance: `duration = clamp(distance / SPEED, MIN_DUR, MAX_DUR)`. Roughly mirrors the pace
 * of the pointer field so push and pull-back feel related.
 */
const LATTICE_GLIDE_TARGET_SPEED_PX_PER_S = 80;
const LATTICE_GLIDE_MIN_DURATION_MS = 600;
const LATTICE_GLIDE_MAX_DURATION_MS = 3200;
/** Spawn-time appear animation uses its own (faster) pace, independent of post-release tuning. */
const LATTICE_GLIDE_SPAWN_TARGET_SPEED_PX_PER_S = 160;
const LATTICE_GLIDE_SPAWN_MIN_DURATION_MS = 380;
const LATTICE_GLIDE_SPAWN_MAX_DURATION_MS = 1600;
/** `returning` kinematic homing hands off to glide when closer than this × cell (larger = sooner). */
const LATTICE_GLIDE_RETURNING_HANDOFF_MULT = 5.45;
const LATTICE_GLIDE_SNAP_MULT = 0.032;
/**
 * Abort glide and restore tether if farther than this × cell from anchor (must exceed handoff radii).
 */
const LATTICE_GLIDE_ABORT_MULT = 7.15;
const LATTICE_GLIDE_MAX_MS = 4800;

/** Minimum pointer-field radius in CSS px; {@link BoxesLayer.pointerRepulsionRadiusPx} also scales with cell size. */
const POINTER_REPULSE_RADIUS_CSS = 108;
/** Peak repulsion force (Matter units); scaled by falloff inside the disc. */
const POINTER_REPULSE_FORCE = 0.00112;
/** Falling tiles (mid-air) still feel the field, but at this fraction of the bound-tile push. */
const POINTER_REPULSE_FALLING_MULT = 0.4;
/** Blend: linear+quadratic falloff so mid-disc push is stronger than pure edge². */
const POINTER_REPULSE_FALLOFF_LINEAR = 0.3;

/**
 * When a cell’s hull intersects the repulsion disc but its center lies outside radius R, still apply
 * outward push using at least this normalized edge term (0–1) before linear/quadratic falloff.
 */
const POINTER_FIELD_HULL_OVERLAP_MIN_EDGE = 0.175;

/**
 * At-rest floor for speed scaling: **1** so a stationary press still gets full radial falloff (H1). Higher
 * speeds add up to {@link POINTER_FIELD_SPEED_CAP_MULT}.
 */
const POINTER_FIELD_SPEED_AT_REST_MULT = 1;
const POINTER_FIELD_SPEED_CAP_MULT = 2.4;
const POINTER_FIELD_SPEED_REF_PX_PER_MS = 0.72;

/** Gentle alignment while `bound` (constraint still allows some spin). */
const BOUND_ANGLE_DAMP = 0.94;

/** After `falling` rests on the **physics floor** (not letter-on-letter), dwell before homing. */
const RETURN_DELAY_MS = 480;

/** Exponential homing before tether handoff (after floor or air-stuck). */
const HOMING_LAMBDA = 0.5;

/** While `falling`, resting for dwell requires real floor contact (`FLOOR_LABEL`), not another letter. */
const REST_SPEED_MAX = 0.52;

const SUPPORT_DY_MIN = 0.55;

const BOUNDS_PAD_CSS = 3;

/**
 * Tile lifecycle:
 * - `bound`: at-rest near anchor (dynamic body + tether). Default phase; receives full pointer-field force.
 * - `falling`: yanked free / past release distance; flies under gravity. Receives weak pointer-field force.
 * - `returning`: kinematic (`isStatic = true` only here) homing back into the slot from far away.
 *
 * No static "locked" lattice anymore: tiles are dynamic from spawn so the pointer field can always push them.
 */
type AnchorPhase = 'bound' | 'falling' | 'returning';

type LetterRecord = {
  /** One Matter body = one filled mosaic cell (“box”), not a whole glyph/letter. */
  body: Body;
  g: Graphics;
  order: number;
  gx: number;
  gy: number;
  anchorX: number;
  anchorY: number;
  anchorPhase: AnchorPhase;
  floorDwellMs: number;
  touchingFloor: boolean;
  touchingSupport: boolean;
  /** Ms spent nearly motionless while off-anchor; kicks homing when stuck. */
  offAnchorStillMs: number;
  /** `falling` and not on floor: accumulates low-speed air stuck time → homing. */
  airStuckMs: number;
  /** `bound` after tether handoff: nearly home & still → slow commit to `locked`. */
  tetherSettleMs: number;
  /**
   * After this box was last affected by **pointer session** (grab or repulsion from a grab), tether /
   * homing strength ramps 0→1 over {@link POST_INTERACT_HOME_RESUME_MS}. `-1` = never; full strength.
   */
  lastBoxInteractPerf: number;
  /** Active only in `bound`; removed for `falling` / `returning` / `locked`. */
  anchorTether: ConstraintType | null;
  /** Ms with negligible distance change after physics while gliding. */
  latticeGlideStuckMs: number;
  /** Ms with near-zero body velocity while gliding but still off-slot (see {@link LATTICE_GLIDE_LOW_MOTION_MS}). */
  latticeGlideLowMotionMs: number;
  /** Previous anchor distance (after physics); `-1` = unset. */
  latticeGlideLastDist: number;
  /** Wall-clock in current glide segment; caps total glide duration. */
  latticeGlideElapsedMs: number;
  /** Body position when the current glide segment started; used to drive the ease-in-out curve. */
  latticeGlideStartX: number;
  latticeGlideStartY: number;
  /**
   * Body velocity (CSS px / ms) captured at glide entry so the cubic Hermite curve can preserve
   * the tile's incoming momentum, decelerate it smoothly, then reverse toward the anchor — instead
   * of clamping velocity to 0 at entry (which produces a visible "jerk back").
   */
  latticeGlideStartVx: number;
  latticeGlideStartVy: number;
  /** Distance-derived target duration for the current glide segment (ms). `0` = unset. */
  latticeGlideDurationMs: number;
  /**
   * True for the initial appear animation segment; switches the curve to the spawn-tuned target
   * speed/duration bounds so artwork load-in stays snappy independent of post-release pace.
   */
  latticeGlideIsSpawn: boolean;
  /** Ms with no anchor progress while `bound` (see {@link BOUND_STUCK_MS}). */
  boundStuckMs: number;
  /** Ms with near-zero velocity in the bound stuck zone (see {@link BOUND_STUCK_LOW_MOTION_MS}). */
  boundLowMotionMs: number;
  /** `bound` only: off-anchor + quiet body; see {@link QUIET_OFF_HOME_MS}. */
  quietOffHomeMs: number;
  /**
   * Dynamic tile off lattice anchor: accumulates toward {@link OFF_ANCHOR_RESPAWN_MS} → hard respawn.
   */
  offAnchorRespawnMs: number;
  /** Prior anchor distance for stuck detection; `-1` = unset. */
  boundStuckLastDist: number;
  /**
   * True while doing the final visual slide onto the slot: tether off, full letter collisions, no
   * pointer repulsion — only direct grab cancels (see {@link cancelLatticeGlide}).
   */
  latticeGlide: boolean;
};

type DragPayload = IEvent<Manipulator> & { body: Body | null };

type MouseWithButton = Mouse & {
  button: number;
  absolute: { x: number; y: number };
  scale: { x: number; y: number };
  offset: { x: number; y: number };
};

/** True if circle (center cx,cy radius r) intersects axis-aligned rectangle [minX,maxX]×[minY,maxY]. */
function circleIntersectsAabb(
  cx: number,
  cy: number,
  r: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): boolean {
  const nx = Math.max(minX, Math.min(cx, maxX));
  const ny = Math.max(minY, Math.min(cy, maxY));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy <= r * r;
}

function pointToSegmentDistanceSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const abLenSq = abx * abx + aby * aby;
  if (abLenSq < 1e-12) {
    return apx * apx + apy * apy;
  }
  let t = (apx * abx + apy * aby) / abLenSq;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * abx;
  const qy = ay + t * aby;
  const dx = px - qx;
  const dy = py - qy;
  return dx * dx + dy * dy;
}

/**
 * True if a disc (center `pt`, radius) intersects the body’s convex part polygon — AABB is only a
 * cheap reject (no “AABB overlap alone counts as hit”, which false-positived on rotated tiles).
 */
function letterPointerHitDisc(pt: { x: number; y: number }, radius: number, body: Body): boolean {
  const { min, max } = body.bounds;
  if (!circleIntersectsAabb(pt.x, pt.y, radius, min.x, min.y, max.x, max.y)) return false;
  const r2 = radius * radius;
  const start = body.parts.length > 1 ? 1 : 0;
  for (let p = start; p < body.parts.length; p++) {
    const verts = body.parts[p].vertices;
    if (Vertices.contains(verts, pt)) return true;
    for (let i = 0; i < verts.length; i++) {
      const v0 = verts[i];
      const v1 = verts[(i + 1) % verts.length];
      const vx = v0.x - pt.x;
      const vy = v0.y - pt.y;
      if (vx * vx + vy * vy <= r2) return true;
      if (pointToSegmentDistanceSq(pt.x, pt.y, v0.x, v0.y, v1.x, v1.y) <= r2) return true;
    }
  }
  return false;
}

/**
 * Closest point on the mosaic cell’s convex hull (world vertices) to the pointer, and distance to it.
 * Used for radial push **from the surface** so influence starts when the field reaches the near face,
 * not when the **body center** enters radius R.
 */
function letterClosestSurfacePointToPointer(
  body: Body,
  px: number,
  py: number,
): { qx: number; qy: number; dist: number } {
  let bestD2 = Infinity;
  let qx = body.position.x;
  let qy = body.position.y;
  const start = body.parts.length > 1 ? 1 : 0;
  for (let p = start; p < body.parts.length; p++) {
    const verts = body.parts[p].vertices;
    const n = verts.length;
    for (let i = 0; i < n; i++) {
      const v0 = verts[i];
      const v1 = verts[(i + 1) % n];
      const abx = v1.x - v0.x;
      const aby = v1.y - v0.y;
      const apx = px - v0.x;
      const apy = py - v0.y;
      const abLenSq = abx * abx + aby * aby;
      let t = abLenSq > 1e-12 ? (apx * abx + apy * aby) / abLenSq : 0;
      t = Math.max(0, Math.min(1, t));
      const cx = v0.x + t * abx;
      const cy = v0.y + t * aby;
      const dx = px - cx;
      const dy = py - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        qx = cx;
        qy = cy;
      }
    }
  }
  return { qx, qy, dist: Math.sqrt(Math.max(bestD2, 0)) };
}

const letterFilterFull = () => ({
  category: LETTER_CATEGORY,
  mask: LETTER_CATEGORY | WALL_CATEGORY,
  group: 0,
});

const letterFilterWallsOnly = () => ({
  category: LETTER_CATEGORY,
  mask: WALL_CATEGORY,
  group: 0,
});

export class BoxesLayer {
  readonly root = new Container();
  readonly engine: Engine;

  private mouse!: Mouse;
  private mouseConstraint!: MouseConstraint;

  private letterRecords: LetterRecord[] = [];
  private walls: Body[] = [];

  private resizeHandler!: () => void;
  private readonly onCollisionStart: (ev: IEventCollision<Engine>) => void;
  private readonly onCollisionActive: (ev: IEventCollision<Engine>) => void;
  private readonly onDragStart: (ev: IEvent<Manipulator>) => void;
  private readonly onDragEnd: (ev: IEvent<Manipulator>) => void;
  private readonly onCanvasPointerMove: (ev: PointerEvent) => void;
  private readonly onCanvasPointerLeave: () => void;
  private readonly onCanvasPointerDown: (ev: PointerEvent) => void;

  private readonly app: Application;
  private lastPointerCanvasCss: { x: number; y: number } | null = null;
  private layoutFrozen = false;
  private cellSizeCss = 20;
  /** `${gx},${gy}` → lattice anchor; rebuilt once per {@link BoxesLayer.update}. */
  private anchorLayoutCache = new Map<string, { x: number; y: number }>();

  private primaryPointerDownOnCanvas = false;
  /**
   * True when **pointerdown** overlapped any mosaic cell under {@link pointerEngageRadiusForGrabPx}
   * (tighter than fat-finger {@link pointerInteractionRadiusPx}): enables grab path + fat finger.
   */
  private pointerDownStartedOnLetter = false;
  /** Set when canvas uses Pointer Capture so move/up follow the finger reliably. */
  private pointerCaptureId: number | null = null;

  /**
   * Previous pointer position for **speed-scaled** radial field strength ({@link applyPointerFieldBeforeStep}).
   * Reset on pointer up / new press.
   */
  private pointerFieldPrevPx = Number.NaN;
  private pointerFieldPrevPy = Number.NaN;

  private readonly onWindowPointerEnd: () => void;
  private readonly onWindowPointerMoveWhileDown: (ev: PointerEvent) => void;

  private lastValidViewport: { cw: number; ch: number } | null = null;

  /**
   * Mosaic cell currently grabbed by `MouseConstraint`, if any. Prefer over `mouseConstraint.body` alone:
   * Matter sometimes exposes the attachment only on `constraint.bodyB` for a step.
   */
  private mouseGrabLetterBody(): Body | null {
    const mc = this.mouseConstraint;
    const b = mc.body ?? mc.constraint.bodyB;
    return b != null && b.label === LETTER_LABEL ? b : null;
  }

  /**
   * True when the mouse constraint is pulling a **mosaic box** body (one `LetterRecord` cell), not
   * a “letter” glyph. Letters in the UI are made of many such boxes.
   */
  private isDraggingBox(): boolean {
    return this.mouseGrabLetterBody() != null;
  }

  /**
   * Radius of the radial pointer **force field** (wake + repulsion). Larger than pick/grab radius;
   * scales with {@link cellSizeCss}. See {@link pointerInteractionRadiusPx} for fat-finger grab.
   */
  private pointerRepulsionRadiusPx(): number {
    return Math.max(POINTER_REPULSE_RADIUS_CSS, this.cellSizeCss * 3.68);
  }

  /**
   * Homing / anchor-tether scale from {@link LetterRecord.lastBoxInteractPerf} (grab + repulsion).
   * The grabbed box stays at 0 while `mouseConstraint` holds it.
   */
  private boxHomingEase(r: LetterRecord): number {
    const b = r.body;
    const grab = this.mouseGrabLetterBody();
    if (grab != null && grab === b) return 0;
    if (r.lastBoxInteractPerf < 0) return 1;
    const dt = performance.now() - r.lastBoxInteractPerf;
    return Math.max(0, Math.min(1, dt / POST_INTERACT_HOME_RESUME_MS));
  }

  /**
   * Drive Matter mouse in the same **CSS canvas space** as mosaic bodies ({@link layoutSourcehiveInViewport}
   * / {@link getPhysicsViewport}). Do not apply {@link Mouse.scale}: with Pixi `autoDensity`, Matter’s
   * default scale maps to backing-buffer px and would misalign pointer vs bodies on HiDPI.
   */
  private syncMatterMouseToCanvasCss(p: { x: number; y: number }): void {
    const m = this.mouse as MouseWithButton;
    m.absolute.x = p.x;
    m.absolute.y = p.y;
    m.position.x = p.x;
    m.position.y = p.y;
  }

  constructor(app: Application) {
    this.app = app;
    this.engine = Engine.create({
      gravity: { ...GRAVITY },
      enableSleeping: false,
    });
    this.engine.positionIterations = 12;
    this.engine.velocityIterations = 12;
    this.engine.constraintIterations = 4;

    this.mouse = Mouse.create(this.app.canvas);
    const m0 = this.mouse as MouseWithButton;
    m0.scale.x = 1;
    m0.scale.y = 1;
    m0.offset.x = 0;
    m0.offset.y = 0;
    this.mouseConstraint = MouseConstraint.create(this.engine, {
      mouse: this.mouse,
      collisionFilter: {
        category: LETTER_CATEGORY,
        mask: LETTER_CATEGORY,
        group: 0,
      },
      constraint: { stiffness: MOUSE_CONSTRAINT_STIFFNESS, damping: MOUSE_CONSTRAINT_DAMPING },
    });

    Composite.add(this.engine.world, this.mouseConstraint);
    syncMouseDpi(this.mouse, this.app.canvas);

    this.onWindowPointerEnd = () => {
      const hadCanvasPress = this.primaryPointerDownOnCanvas;
      if (hadCanvasPress && this.lastPointerCanvasCss) {
        this.syncMatterMouseToCanvasCss(this.lastPointerCanvasCss);
      }
      this.primaryPointerDownOnCanvas = false;
      this.pointerDownStartedOnLetter = false;
      this.pointerFieldPrevPx = Number.NaN;
      this.pointerFieldPrevPy = Number.NaN;
      (this.mouse as MouseWithButton).button = -1;
      if (this.pointerCaptureId != null) {
        try {
          this.app.canvas.releasePointerCapture(this.pointerCaptureId);
        } catch {
          /* no-op */
        }
        this.pointerCaptureId = null;
      }
      if (POINTER_UP_ENSURE_ANCHOR_TETHER_FOR_ALL_BOUND) {
        for (const r of this.letterRecords) {
          if (r.anchorPhase === 'bound' && !r.body.isStatic) {
            this.ensureAnchorTether(r);
          }
        }
      }
      // On release: enforce a real coast window. Re-stamp `lastBoxInteractPerf` so `boxHomingEase`
      // sits near 0 right after release and climbs to 1 over exactly RELEASE_COAST_MS, regardless
      // of how long the press lasted. While ease is low the tether is in its relax band, so the
      // tile rides its existing field-imparted velocity. Once ease reaches 1, the standard
      // `maybeBeginLatticeGlide` path (already gated on `boxHomingEase >= 1`) hands the tile to
      // the kinematic ease-in-out glide for the controlled return.
      if (hadCanvasPress) {
        const now = performance.now();
        const stampForCoast = now - (POST_INTERACT_HOME_RESUME_MS - RELEASE_COAST_MS);
        for (const r of this.letterRecords) {
          if (r.anchorPhase !== 'bound' && r.anchorPhase !== 'falling') continue;
          if (r.lastBoxInteractPerf > 0) {
            r.lastBoxInteractPerf = stampForCoast;
          }
        }
      }
    };

    this.onWindowPointerMoveWhileDown = (ev: PointerEvent) => {
      if (!this.primaryPointerDownOnCanvas) return;
      this.lastPointerCanvasCss = clientToCanvasCss(ev.clientX, ev.clientY, this.app);
      this.syncMatterMouseToCanvasCss(this.lastPointerCanvasCss);
    };

    window.addEventListener('pointerup', this.onWindowPointerEnd, { passive: true });
    window.addEventListener('pointercancel', this.onWindowPointerEnd, { passive: true });
    window.addEventListener('pointermove', this.onWindowPointerMoveWhileDown, { passive: true });

    this.onDragStart = (ev: IEvent<Manipulator>) => {
      const b = (ev as DragPayload).body;
      if (!b || b.label !== LETTER_LABEL) return;
      this.wakeLetter(b);
      const rec = this.letterRecords.find((r) => r.body === b);
      if (rec?.latticeGlide) this.cancelLatticeGlide(rec);
      if (rec?.anchorPhase === 'bound') this.removeAnchorTether(rec);
    };

    this.onDragEnd = (ev: IEvent<Manipulator>) => {
      const b = (ev as DragPayload).body;
      if (!b || b.label !== LETTER_LABEL) return;
      const rec = this.letterRecords.find((r) => r.body === b);
      if (!rec) return;
      const now = performance.now();
      rec.lastBoxInteractPerf = now;
      if (rec.anchorPhase === 'bound' && !rec.body.isStatic) {
        const dx = rec.anchorX - rec.body.position.x;
        const dy = rec.anchorY - rec.body.position.y;
        const dist = Math.hypot(dx, dy);
        const releaseDist = RELEASE_DIST_MULT * this.cellSizeCss;
        if (dist > releaseDist) {
          this.transitionBoundToFallingFromReleaseBand(rec);
        } else {
          this.ensureAnchorTether(rec);
        }
      }
    };

    this.onCanvasPointerMove = (ev: PointerEvent) => {
      this.lastPointerCanvasCss = clientToCanvasCss(ev.clientX, ev.clientY, this.app);
      this.syncMatterMouseToCanvasCss(this.lastPointerCanvasCss);
    };

    this.onCanvasPointerLeave = () => {
      if (!this.primaryPointerDownOnCanvas) {
        this.lastPointerCanvasCss = null;
      }
    };

    this.onCanvasPointerDown = (ev: PointerEvent) => {
      const isPrimary =
        ev.pointerType === 'touch'
          ? true
          : ev.pointerType === 'mouse' || ev.pointerType === 'pen'
            ? ev.button === 0
            : ev.isPrimary;
      if (!isPrimary) return;

      this.primaryPointerDownOnCanvas = true;
      (this.mouse as MouseWithButton).button = 0;

      const p = clientToCanvasCss(ev.clientX, ev.clientY, this.app);
      this.lastPointerCanvasCss = p;
      this.syncMatterMouseToCanvasCss(p);
      const mp = this.mouse.position;
      this.pointerDownStartedOnLetter = this.pointerDownEngagedMosaicAtPress(mp);
      this.pointerFieldPrevPx = Number.NaN;
      this.pointerFieldPrevPy = Number.NaN;
      try {
        (ev.currentTarget as HTMLCanvasElement).setPointerCapture(ev.pointerId);
        this.pointerCaptureId = ev.pointerId;
      } catch {
        this.pointerCaptureId = null;
      }
      if (ev.pointerType === 'touch') {
        ev.preventDefault();
      }
    };

    this.onCollisionStart = (ev: IEventCollision<Engine>) => {
      for (const pair of ev.pairs) {
        this.applyFloorContactFromPair(pair);
        this.applyLetterSupportFromPair(pair);
        this.maybeWakeFromCollisionPair(pair);
      }
    };

    this.onCollisionActive = (ev: IEventCollision<Engine>) => {
      for (const pair of ev.pairs) {
        this.applyFloorContactFromPair(pair);
        this.applyLetterSupportFromPair(pair);
      }
    };

    Events.on(this.mouseConstraint, 'startdrag', this.onDragStart);
    Events.on(this.mouseConstraint, 'enddrag', this.onDragEnd);
    Events.on(this.engine, 'collisionStart', this.onCollisionStart);
    Events.on(this.engine, 'collisionActive', this.onCollisionActive);

    const canvas = this.app.canvas;
    canvas.addEventListener('pointermove', this.onCanvasPointerMove, { passive: true });
    canvas.addEventListener('pointerleave', this.onCanvasPointerLeave, { passive: true });
    canvas.addEventListener('pointerdown', this.onCanvasPointerDown);

    this.resizeHandler = () => {
      this.relayout(getPhysicsViewport(this.app));
      syncMouseDpi(this.mouse, this.app.canvas);
    };

    window.addEventListener('resize', this.resizeHandler, { passive: true });
    window.addEventListener('orientationchange', this.resizeHandler, { passive: true });

    requestAnimationFrame(() => {
      void this.relayout(getPhysicsViewport(this.app));
    });
  }

  /** Clears mosaic grab when {@link BOX_POINTER_GRAB_DISABLED} so Matter cannot retain `bodyB`. */
  private clearLetterMouseGrabIfDisabled(): void {
    if (!BOX_POINTER_GRAB_DISABLED) return;
    const mc = this.mouseConstraint;
    const b = mc.body ?? mc.constraint.bodyB;
    if (b && b.label === LETTER_LABEL) {
      this.releaseMouseConstraintIfDraggingBody(b);
    }
  }

  /**
   * Matter runs {@link MouseConstraint} on `beforeUpdate` and attaches when the pointer lies inside
   * a body's hull. Clearing `bodyB` after {@link Engine.update} cannot undo forces applied during the
   * physics step. For field-only presses (`!pointerDownStartedOnLetter`), set `collisionFilter.mask`
   * to 0 so {@link Detector.canCollide} never picks mosaic cells (evidence: matter-js
   * `MouseConstraint.update` + `Detector.canCollide`).
   */
  private syncMouseConstraintPickCollisionFilter(): void {
    if (BOX_POINTER_GRAB_DISABLED) return;
    const mc = this.mouseConstraint;
    if (this.primaryPointerDownOnCanvas && !this.pointerDownStartedOnLetter) {
      mc.collisionFilter = {
        category: LETTER_CATEGORY,
        mask: 0,
        group: 0,
      };
      const b = this.mouseGrabLetterBody();
      if (b) {
        this.releaseMouseConstraintIfDraggingBody(b);
      }
    } else {
      mc.collisionFilter = {
        category: LETTER_CATEGORY,
        mask: LETTER_CATEGORY,
        group: 0,
      };
    }
  }

  /**
   * If the user pressed down outside the mosaic pick disc, prevent `MouseConstraint` from attaching to
   * a letter when the cursor later crosses tiles (Matter + fat finger). The pointer field is unchanged.
   */
  private suppressMisalignedLetterMouseGrab(): void {
    if (this.pointerDownStartedOnLetter) return;
    if (!this.primaryPointerDownOnCanvas) return;
    const mc = this.mouseConstraint;
    const b = mc.body ?? mc.constraint.bodyB;
    if (b && b.label === LETTER_LABEL) {
      this.releaseMouseConstraintIfDraggingBody(b);
    }
  }

  /**
   * Strict click-on-square: pointerdown only "engages" the mosaic for grab if the cursor lies inside
   * an actual tile hull (`Vertices.contains`). No fat-finger disc — anything else is field-only and
   * Matter's `MouseConstraint` is mask-disabled by {@link syncMouseConstraintPickCollisionFilter}.
   */
  private pointerDownEngagedMosaicAtPress(pt: { x: number; y: number }): boolean {
    for (const rec of this.letterRecords) {
      const body = rec.body;
      if (body.label !== LETTER_LABEL) continue;
      const start = body.parts.length > 1 ? 1 : 0;
      for (let p = start; p < body.parts.length; p++) {
        if (Vertices.contains(body.parts[p].vertices, pt)) return true;
      }
    }
    return false;
  }

  /** Radius (CSS px) used only by neighbor-tether-cut while dragging; pointer grab itself is strict-hull. */
  private pointerInteractionRadiusPx(): number {
    return Math.max(POINTER_INTERACTION_RADIUS_CSS, this.cellSizeCss * 1.2);
  }

  private fillAnchorCacheFromLayout(layout: ReturnType<typeof layoutSourcehiveInViewport>): void {
    this.cellSizeCss = layout.cellSizeCss;
    const cache = this.anchorLayoutCache;
    cache.clear();
    for (const t of layout.tiles) {
      cache.set(`${t.gx},${t.gy}`, { x: t.x, y: t.y });
    }
  }

  private syncViewportAnchorCache(): void {
    const { cw, ch } = getPhysicsViewport(this.app);
    const layout = layoutSourcehiveInViewport(cw, ch, LAYOUT_FRAC_Y);
    this.fillAnchorCacheFromLayout(layout);
  }

  private syncRecordAnchorToLayout(r: LetterRecord): void {
    const p = this.anchorLayoutCache.get(`${r.gx},${r.gy}`);
    if (p) {
      r.anchorX = p.x;
      r.anchorY = p.y;
    }
  }

  private removeAnchorTether(r: LetterRecord): void {
    if (!r.anchorTether) return;
    Composite.remove(this.engine.world, r.anchorTether);
    r.anchorTether = null;
  }

  /** Avoid dangling `MouseConstraint` after removing its `bodyB` from the world. */
  private releaseMouseConstraintIfDraggingBody(body: Body): void {
    const mc = this.mouseConstraint;
    const c = mc.constraint;
    if (c.bodyB !== body && mc.body !== body) return;
    (c as { bodyB: Body | null }).bodyB = null;
    (mc as { body: Body | null }).body = null;
  }

  /** Matter constraint: pulls body toward current `anchorX/Y` while `bound`. */
  private ensureAnchorTether(r: LetterRecord): void {
    if (r.latticeGlide) return;
    if (r.anchorPhase !== 'bound' || r.body.isStatic) return;
    if (r.anchorTether) {
      r.anchorTether.pointA.x = r.anchorX;
      r.anchorTether.pointA.y = r.anchorY;
      return;
    }
    const c = Constraint.create({
      pointA: { x: r.anchorX, y: r.anchorY },
      bodyB: r.body,
      pointB: { x: 0, y: 0 },
      stiffness: TETHER_STIFFNESS_NEAR,
      damping: TETHER_DAMPING_NEAR,
      length: 0,
    });
    r.anchorTether = c;
    Composite.add(this.engine.world, c);
  }

  private resetGlideProgress(r: LetterRecord): void {
    r.latticeGlideStuckMs = 0;
    r.latticeGlideLowMotionMs = 0;
    r.latticeGlideLastDist = -1;
    r.latticeGlideElapsedMs = 0;
    r.latticeGlideStartX = r.body.position.x;
    r.latticeGlideStartY = r.body.position.y;
    r.latticeGlideStartVx = 0;
    r.latticeGlideStartVy = 0;
    r.latticeGlideDurationMs = 0;
    r.latticeGlideIsSpawn = false;
    r.boundStuckMs = 0;
    r.boundLowMotionMs = 0;
    r.quietOffHomeMs = 0;
    r.boundStuckLastDist = -1;
  }

  /**
   * `stiffness`/`damping` on the anchor constraint: weak at anchor, stronger as stretch approaches release.
   */
  private updateBoundTetherStrength(): void {
    const tetherRampDist = TETHER_RAMP_DIST_MULT * this.cellSizeCss;
    const invRamp = 1 / Math.max(tetherRampDist, 1e-6);
    const relaxR = Math.max(8, TETHER_RELAX_RADIUS_MULT * this.cellSizeCss);
    const pt = this.mouse.position;
    const pickR = this.pointerInteractionRadiusPx();
    const dragged = this.mouseGrabLetterBody();
    const dragging = this.isDraggingBox();
    const canvasPress = this.primaryPointerDownOnCanvas;
    const mouseDown = (this.mouse as MouseWithButton).button === 0;
    /** Matter can keep `mouseConstraint.body` for a frame or two after window pointerup — avoid stripping neighbor tethers then. */
    const allowNeighborTetherCut = dragging && canvasPress && mouseDown;

    for (const r of this.letterRecords) {
      if (r.anchorPhase !== 'bound' || r.body.isStatic) continue;
      if (r.latticeGlide) continue;
      const b = r.body;
      if (dragged === b) continue;

      const cutNeighbor =
        NEIGHBOR_TETHER_CUT_WHILE_DRAG &&
        allowNeighborTetherCut &&
        dragged !== b &&
        letterPointerHitDisc(pt, pickR, b);
      if (cutNeighbor) {
        this.removeAnchorTether(r);
        continue;
      }

      this.ensureAnchorTether(r);
      if (!r.anchorTether) continue;

      const dist = Math.hypot(r.anchorX - b.position.x, r.anchorY - b.position.y);
      const u = Math.min(1, dist * invRamp);
      const curve = u * u * u;
      const stiffMid =
        TETHER_STIFFNESS_NEAR + (TETHER_STIFFNESS_FAR - TETHER_STIFFNESS_NEAR) * curve;
      const dampMid = TETHER_DAMPING_NEAR + (TETHER_DAMPING_FAR - TETHER_DAMPING_NEAR) * curve;
      const relaxBlend = Math.min(1, dist / relaxR);
      let stiff =
        TETHER_STIFFNESS_RELAX * (1 - relaxBlend) + stiffMid * relaxBlend;
      let damp = TETHER_DAMPING_RELAX * (1 - relaxBlend) + dampMid * relaxBlend;

      const boxEase = this.boxHomingEase(r);
      stiff *= boxEase;
      damp *= boxEase;

      r.anchorTether.stiffness = stiff;
      r.anchorTether.damping = damp;
    }
  }
  /**
   * Primary-button **radial pointer field** centered on the cursor:
   * - **Influence:** `dSurf < R` **or** body center `dCenter < R` **or** hull-disc intersect (H3).
   * - **Direction / falloff:** prefer **surface** outward; if degenerate, use **center** radial (H3).
   * - **Strength:** falloff from `dSurf`, scaled by cursor speed (see constants above).
   *
   * Skips the grabbed body and `returning` / `falling` / `latticeGlide` tiles (`locked` statics are woken only).
   */
  private applyPointerFieldBeforeStep(dt: number): void {
    if (!this.primaryPointerDownOnCanvas) return;
    const btn = (this.mouse as MouseWithButton).button;
    if (btn !== 0) return;
    const px = this.mouse.position.x;
    const py = this.mouse.position.y;
    const dtSafe = Math.max(dt, 1e-6);
    let cursorSpeedPxPerMs = 0;
    if (Number.isFinite(this.pointerFieldPrevPx) && Number.isFinite(this.pointerFieldPrevPy)) {
      cursorSpeedPxPerMs =
        Math.hypot(px - this.pointerFieldPrevPx, py - this.pointerFieldPrevPy) / dtSafe;
    }
    this.pointerFieldPrevPx = px;
    this.pointerFieldPrevPy = py;
    const speedT = Math.min(1, cursorSpeedPxPerMs / POINTER_FIELD_SPEED_REF_PX_PER_MS);
    const speedFactor =
      POINTER_FIELD_SPEED_AT_REST_MULT +
      (POINTER_FIELD_SPEED_CAP_MULT - POINTER_FIELD_SPEED_AT_REST_MULT) * speedT;

    const R = this.pointerRepulsionRadiusPx();
    const dragged = this.mouseGrabLetterBody();
    const now = performance.now();

    for (const r of this.letterRecords) {
      const b = r.body;
      if (b.label !== LETTER_LABEL) continue;

      const { qx, qy, dist: dSurf } = letterClosestSurfacePointToPointer(b, px, py);
      const dCenter = Math.hypot(b.position.x - px, b.position.y - py);

      const inField =
        dSurf < R || dCenter < R || letterPointerHitDisc({ x: px, y: py }, R, b);
      if (!inField) continue;
      if (b.isStatic) continue;
      if (dragged === b) continue;
      if (r.anchorPhase === 'returning') continue;
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
        POINTER_REPULSE_FALLOFF_LINEAR * edge +
        (1 - POINTER_REPULSE_FALLOFF_LINEAR) * edge * edge;
      const phaseMult = r.anchorPhase === 'falling' ? POINTER_REPULSE_FALLING_MULT : 1;
      const mag = POINTER_REPULSE_FORCE * falloff * speedFactor * phaseMult;
      Body.applyForce(b, b.position, { x: nx * mag, y: ny * mag });
      r.lastBoxInteractPerf = now;
    }
  }

  private boundAngularDampBeforeStep(): void {
    const dragged = this.mouseGrabLetterBody();
    for (const r of this.letterRecords) {
      const b = r.body;
      if (b.isStatic || r.anchorPhase !== 'bound' || dragged === b) continue;
      if (r.latticeGlide) continue;
      Body.setAngularVelocity(b, b.angularVelocity * BOUND_ANGLE_DAMP);
    }
  }

  /**
   * Tiles are dynamic from spawn now, so this is mostly a safety helper for the rare path where a
   * `returning` body (kinematic-static) needs to become dynamic again, or for collision-driven wake of
   * a static recovery rebuild. Always-dynamic mosaic = no per-press wake bookkeeping.
   */
  private wakeLetter(b: Body): void {
    const rec = this.letterRecords.find((r) => r.body === b);
    if (b.isStatic) {
      Body.setStatic(b, false);
    }
    Sleeping.set(b, false);
    if (rec) {
      this.syncRecordAnchorToLayout(rec);
      rec.anchorPhase = 'bound';
      rec.floorDwellMs = 0;
      rec.touchingFloor = false;
      rec.touchingSupport = false;
      rec.offAnchorStillMs = 0;
      rec.airStuckMs = 0;
      rec.tetherSettleMs = 0;
      rec.latticeGlide = false;
      this.resetGlideProgress(rec);
    }
    b.collisionFilter = letterFilterFull();
    if (!Number.isFinite(b.mass) || !Number.isFinite(b.inertia)) {
      const c = Vertices.centre(b.vertices);
      const local = b.vertices.map((v) => ({ x: v.x - c.x, y: v.y - c.y }));
      b.mass = 1;
      b.inverseMass = 1;
      const unitInertia = Vertices.inertia(local, 1);
      Body.setInertia(b, MATTER_INERTIA_SCALE * unitInertia);
    }
    Body.setDensity(b, LETTER_BODY_DENSITY);
    if (rec) this.ensureAnchorTether(rec);
  }

  /**
   * Always-dynamic mosaic means tile-tile collisions no longer need to "wake" anything; bodies are
   * already dynamic and feel pushes directly. Hard hits still transition `bound` → `falling` for the
   * struck tile so it doesn't get yanked back instantly by its tether.
   */
  private maybeWakeFromCollisionPair(pair: IEventCollision<Engine>['pairs'][number]): void {
    const a = pair.bodyA;
    const b = pair.bodyB;
    if (a.label !== LETTER_LABEL || b.label !== LETTER_LABEL) return;
    if (a.isStatic || b.isStatic) return;

    const speedA = Math.hypot(a.velocity.x, a.velocity.y);
    const speedB = Math.hypot(b.velocity.x, b.velocity.y);
    const fast = speedA >= HIT_RELEASE_SPEED ? a : speedB >= HIT_RELEASE_SPEED ? b : null;
    if (!fast) return;
    const target = fast === a ? b : a;

    const rec = this.letterRecords.find((r) => r.body === target);
    if (!rec || rec.anchorPhase !== 'bound') return;
    rec.anchorPhase = 'falling';
    rec.floorDwellMs = 0;
    rec.offAnchorStillMs = 0;
    rec.airStuckMs = 0;
    rec.tetherSettleMs = 0;
    this.removeAnchorTether(rec);
  }

  private applyFloorContactFromPair(pair: IEventCollision<Engine>['pairs'][number]): void {
    const a = pair.bodyA;
    const b = pair.bodyB;
    if (a.label === FLOOR_LABEL && b.label === LETTER_LABEL && !b.isStatic) {
      const r = this.letterRecords.find((rec) => rec.body === b);
      if (r) r.touchingFloor = true;
      return;
    }
    if (b.label === FLOOR_LABEL && a.label === LETTER_LABEL && !a.isStatic) {
      const r = this.letterRecords.find((rec) => rec.body === a);
      if (r) r.touchingFloor = true;
    }
  }

  private applyLetterSupportFromPair(pair: IEventCollision<Engine>['pairs'][number]): void {
    const a = pair.bodyA;
    const b = pair.bodyB;
    if (a.label !== LETTER_LABEL || b.label !== LETTER_LABEL) return;
    const dyBetween = b.position.y - a.position.y;
    const upper = dyBetween >= 0 ? a : b;
    const lower = upper === a ? b : a;
    if (upper.isStatic) return;
    const dy = lower.position.y - upper.position.y;
    if (dy < SUPPORT_DY_MIN) return;
    if (pair.collision.depth <= pair.slop + 0.02) return;
    const rec = this.letterRecords.find((r) => r.body === upper);
    if (rec) rec.touchingSupport = true;
  }

  private clearDynamicFloorContact(): void {
    for (const r of this.letterRecords) {
      if (!r.body.isStatic) {
        r.touchingFloor = false;
        r.touchingSupport = false;
      }
    }
  }

  /**
   * Visually seat a tile on its lattice slot WITHOUT making it static. Snaps position/velocity, sets
   * `bound`, ensures the anchor tether. Used by drag-end, glide finish, and quiet-stuck shortcuts so
   * tiles always remain dynamic and so the pointer field can keep pushing them on the next press.
   */
  private settleLetterAtAnchor(r: LetterRecord): void {
    const b = r.body;
    this.syncRecordAnchorToLayout(r);
    if (b.isStatic) Body.setStatic(b, false);
    b.collisionFilter = letterFilterFull();
    Body.setPosition(b, { x: r.anchorX, y: r.anchorY });
    Body.setAngle(b, 0);
    Body.setVelocity(b, { x: 0, y: 0 });
    Body.setAngularVelocity(b, 0);
    Sleeping.set(b, false);
    r.anchorPhase = 'bound';
    r.floorDwellMs = 0;
    r.touchingFloor = false;
    r.touchingSupport = false;
    r.offAnchorStillMs = 0;
    r.airStuckMs = 0;
    r.tetherSettleMs = 0;
    r.latticeGlide = false;
    r.offAnchorRespawnMs = 0;
    this.resetGlideProgress(r);
    this.ensureAnchorTether(r);
  }

  /** Same release span as {@link tryReleaseFromMotion}; use from drag-end so behavior cannot drift. */
  private transitionBoundToFallingFromReleaseBand(rec: LetterRecord): void {
    rec.latticeGlide = false;
    this.resetGlideProgress(rec);
    rec.anchorPhase = 'falling';
    rec.floorDwellMs = 0;
    rec.offAnchorStillMs = 0;
    rec.airStuckMs = 0;
    rec.tetherSettleMs = 0;
    this.removeAnchorTether(rec);
  }

  private tryReleaseFromMotion(rec: LetterRecord, dragged: Body | null | undefined): void {
    const b = rec.body;
    if (rec.anchorPhase !== 'bound' || b.isStatic || dragged === b) return;

    const dx = rec.anchorX - b.position.x;
    const dy = rec.anchorY - b.position.y;
    const dist = Math.hypot(dx, dy);
    const releaseDist = RELEASE_DIST_MULT * this.cellSizeCss;
    if (dist > releaseDist) {
      this.transitionBoundToFallingFromReleaseBand(rec);
    }
  }

  /**
   * If a tile sits nearly motionless off its lattice anchor, start homing (no instant snap).
   * Covers `bound` piles and `falling` floor rest that never enter return on their own.
   */
  private tryForceReassembleIfStill(
    r: LetterRecord,
    deltaMs: number,
    dragged: Body | null | undefined,
  ): void {
    const b = r.body;
    if (dragged === b) {
      r.offAnchorStillMs = 0;
      return;
    }
    if (this.isDraggingBox() && r.anchorPhase === 'bound') {
      r.offAnchorStillMs = 0;
      return;
    }
    if (r.anchorPhase === 'returning') {
      r.offAnchorStillMs = 0;
      return;
    }

    if (r.anchorPhase === 'falling') {
      // Only the actual canvas FLOOR counts as "rested"; resting on top of another tile must NOT
      // trigger the homing return (otherwise stacked piles get yanked back to the lattice).
      const grounded = r.touchingFloor;
      if (!grounded || b.isStatic) {
        r.offAnchorStillMs = 0;
        return;
      }
    } else if (r.anchorPhase === 'bound') {
      if (b.isStatic) {
        r.offAnchorStillMs = 0;
        return;
      }
    } else {
      r.offAnchorStillMs = 0;
      return;
    }

    this.syncRecordAnchorToLayout(r);
    const dist = Math.hypot(r.anchorX - b.position.x, r.anchorY - b.position.y);
    const eps = Math.max(1.5, this.cellSizeCss * REASSEMBLY_DIST_EPS_MULT);
    if (dist <= eps) {
      r.offAnchorStillMs = 0;
      return;
    }

    const spd = Math.hypot(b.velocity.x, b.velocity.y);
    const ang = Math.abs(b.angularVelocity);
    const spdLimit =
      r.anchorPhase === 'falling' ? REST_SPEED_MAX : REASSEMBLY_SPEED_MAX_BOUND;
    if (spd > spdLimit || ang > REASSEMBLY_ANG_MAX) {
      r.offAnchorStillMs = 0;
      return;
    }

    r.offAnchorStillMs += deltaMs;
    if (r.offAnchorStillMs < REASSEMBLY_STILL_MS) return;
    if (this.boxHomingEase(r) < 1) {
      r.offAnchorStillMs = REASSEMBLY_STILL_MS;
      return;
    }

    r.offAnchorStillMs = 0;
    r.airStuckMs = 0;
    this.beginReturningPhase(r);
  }

  /**
   * `bound` tile under anchor tether (or already very near its slot): if the pile blocks motion and
   * distance to the anchor barely changes while speeds are low, snap the tile to its lattice cell
   * visually (locked static) — avoids indefinite tether deadlock.
   */
  private maybeForceSnapBoundWhenStuck(
    r: LetterRecord,
    deltaMs: number,
    dragged: Body | null | undefined,
  ): void {
    const b = r.body;
    if (r.anchorPhase !== 'bound' || b.isStatic || r.latticeGlide || dragged === b) {
      r.boundStuckMs = 0;
      r.boundLowMotionMs = 0;
      r.boundStuckLastDist = -1;
      return;
    }
    this.syncRecordAnchorToLayout(r);
    const dist = Math.hypot(r.anchorX - b.position.x, r.anchorY - b.position.y);
    const releaseDist = RELEASE_DIST_MULT * this.cellSizeCss;
    const minOff = Math.max(2.2, this.cellSizeCss * 0.055);
    if (dist <= minOff || dist >= releaseDist * 0.94) {
      r.boundStuckMs = 0;
      r.boundLowMotionMs = 0;
      r.boundStuckLastDist = -1;
      return;
    }
    const hasTether = r.anchorTether != null;
    const nearSlot = dist <= this.cellSizeCss * LATTICE_GLIDE_ENTER_MULT * 1.45;
    if (!hasTether && !nearSlot) {
      r.boundStuckMs = 0;
      r.boundLowMotionMs = 0;
      r.boundStuckLastDist = -1;
      return;
    }
    const spd = Math.hypot(b.velocity.x, b.velocity.y);
    const ang = Math.abs(b.angularVelocity);
    if (spd > BOUND_STUCK_SPD_MAX || ang > BOUND_STUCK_ANG_MAX) {
      r.boundStuckMs = 0;
      r.boundLowMotionMs = 0;
      r.boundStuckLastDist = -1;
      return;
    }
    const last = r.boundStuckLastDist;
    if (last >= 0) {
      if (dist < last - BOUND_STUCK_PROGRESS_MIN) {
        r.boundStuckMs = 0;
        r.boundLowMotionMs = 0;
      } else if (Math.abs(dist - last) < BOUND_STUCK_DIST_EPS) {
        r.boundStuckMs += deltaMs;
      } else {
        r.boundStuckMs = 0;
      }
    } else {
      r.boundStuckMs = 0;
    }
    const microStill =
      spd < BOUND_STUCK_LOW_MOTION_SPD && ang < BOUND_STUCK_LOW_MOTION_ANG;
    if (microStill) {
      r.boundLowMotionMs += deltaMs;
    } else {
      r.boundLowMotionMs = 0;
    }
    r.boundStuckLastDist = dist;
    if (r.boundStuckMs >= BOUND_STUCK_MS || r.boundLowMotionMs >= BOUND_STUCK_LOW_MOTION_MS) {
      this.removeAnchorTether(r);
      this.resetGlideProgress(r);
      this.settleLetterAtAnchor(r);
    }
  }

  /**
   * Simple stuck completion: quiet body, not at anchor, already near the mosaic → lock to lattice cell.
   */
  private maybeSettleBoundWhenQuietOffHome(
    r: LetterRecord,
    deltaMs: number,
    dragged: Body | null | undefined,
  ): void {
    const b = r.body;
    if (r.anchorPhase !== 'bound' || b.isStatic || r.latticeGlide || dragged === b) {
      r.quietOffHomeMs = 0;
      return;
    }
    if (this.isDraggingBox()) {
      r.quietOffHomeMs = 0;
      return;
    }
    this.syncRecordAnchorToLayout(r);
    const dist = Math.hypot(r.anchorX - b.position.x, r.anchorY - b.position.y);
    const atHome = Math.max(1.5, this.cellSizeCss * REASSEMBLY_DIST_EPS_MULT);
    if (dist <= atHome) {
      r.quietOffHomeMs = 0;
      return;
    }
    const dMax = Math.max(12, this.cellSizeCss * QUIET_OFF_HOME_MAX_DIST_MULT);
    if (dist > dMax) {
      r.quietOffHomeMs = 0;
      return;
    }
    const spd = Math.hypot(b.velocity.x, b.velocity.y);
    const ang = Math.abs(b.angularVelocity);
    if (spd > QUIET_OFF_HOME_SPD || ang > QUIET_OFF_HOME_ANG) {
      r.quietOffHomeMs = 0;
      return;
    }
    if (this.boxHomingEase(r) < 1) {
      r.quietOffHomeMs = 0;
      return;
    }
    r.quietOffHomeMs += deltaMs;
    if (r.quietOffHomeMs < QUIET_OFF_HOME_MS) return;
    r.quietOffHomeMs = 0;
    this.removeAnchorTether(r);
    this.resetGlideProgress(r);
    this.settleLetterAtAnchor(r);
  }

  /** Long, nearly still hover at anchor under tether → lock grid (slow final commit). */
  private maybeCommitBoundToLocked(
    r: LetterRecord,
    deltaMs: number,
    dragged: Body | null | undefined,
  ): void {
    const b = r.body;
    if (r.anchorPhase !== 'bound' || b.isStatic || dragged === b) {
      r.tetherSettleMs = 0;
      return;
    }
    this.syncRecordAnchorToLayout(r);
    const dist = Math.hypot(r.anchorX - b.position.x, r.anchorY - b.position.y);
    const eps = Math.max(2, this.cellSizeCss * BOUND_LOCK_DIST_MULT);
    const spd = Math.hypot(b.velocity.x, b.velocity.y);
    const ang = Math.abs(b.angularVelocity);
    if (dist > eps * 1.25 || spd > BOUND_LOCK_SPEED_MAX || ang > BOUND_LOCK_ANG_MAX) {
      r.tetherSettleMs = 0;
      return;
    }
    r.tetherSettleMs += deltaMs;
    if (r.tetherSettleMs < BOUND_LOCK_STILL_MS) return;
    if (this.boxHomingEase(r) < 1) {
      r.tetherSettleMs = BOUND_LOCK_STILL_MS;
      return;
    }
    r.tetherSettleMs = 0;
    this.settleLetterAtAnchor(r);
  }

  private cancelLatticeGlide(r: LetterRecord): void {
    if (!r.latticeGlide) return;
    const b = r.body;
    r.latticeGlide = false;
    b.collisionFilter = letterFilterFull();
    Sleeping.set(b, false);
    Body.setStatic(b, false);
    Body.setVelocity(b, { x: 0, y: 0 });
    Body.setAngularVelocity(b, 0);
    if (r.anchorPhase === 'bound') this.ensureAnchorTether(r);
    this.resetGlideProgress(r);
  }

  /**
   * Glide is a kinematic position lerp. Leaving letter–letter collisions on means `Body.setPosition`
   * can drive the glider INTO a neighbor, and the next-frame collision solver produces a large
   * separation impulse (that's the "jerk" the user reported). Switch to walls-only for the duration
   * of the glide; full collisions are restored in {@link settleLetterAtAnchor} / {@link cancelLatticeGlide}.
   *
   * Captures the body's current velocity (in CSS px / ms) BEFORE zeroing so the cubic Hermite curve
   * can blend it into the start of the return — preserving momentum across the state change.
   */
  private enterLatticeGlide(r: LetterRecord): void {
    const b = r.body;
    this.removeAnchorTether(r);
    b.collisionFilter = letterFilterWallsOnly();
    Sleeping.set(b, false);
    Body.setStatic(b, false);
    const stepMs = this.engine.timing.lastDelta || 1000 / 60;
    const startVx = b.velocity.x / stepMs;
    const startVy = b.velocity.y / stepMs;
    Body.setVelocity(b, { x: 0, y: 0 });
    Body.setAngularVelocity(b, 0);
    this.resetGlideProgress(r);
    r.latticeGlideStartX = b.position.x;
    r.latticeGlideStartY = b.position.y;
    r.latticeGlideStartVx = startVx;
    r.latticeGlideStartVy = startVy;
    r.latticeGlide = true;
  }

  private maybeBeginLatticeGlide(r: LetterRecord, dragged: Body | null | undefined): void {
    const b = r.body;
    if (r.latticeGlide || r.anchorPhase !== 'bound' || b.isStatic || dragged === b) return;
    // If the field has touched this tile recently, do NOT re-enter the kinematic glide — it would
    // override applyForce by snapping the tile back to anchor each tick. Tiles on the leading edge of
    // the mosaic sat right on their anchor and got re-glided every frame, hiding the radial push.
    if (this.boxHomingEase(r) < 1) return;
    this.syncRecordAnchorToLayout(r);
    const dist = Math.hypot(r.anchorX - b.position.x, r.anchorY - b.position.y);
    const dEnter = Math.max(2, this.cellSizeCss * LATTICE_GLIDE_ENTER_MULT);
    if (dist > dEnter) return;
    this.enterLatticeGlide(r);
  }

  private finishLatticeGlide(r: LetterRecord): void {
    r.latticeGlide = false;
    this.settleLetterAtAnchor(r);
  }

  /** Lerp toward anchor before Matter resolves contacts (reduces jitter vs post-step teleport). */
  private applyLatticeGlideBeforePhysics(
    r: LetterRecord,
    dragged: Body | null | undefined,
    deltaMs: number,
  ): void {
    const b = r.body;
    if (dragged === b) {
      this.cancelLatticeGlide(r);
      return;
    }
    if (r.anchorPhase !== 'bound') {
      this.cancelLatticeGlide(r);
      return;
    }

    this.syncRecordAnchorToLayout(r);
    const ax = r.anchorX;
    const ay = r.anchorY;
    const dist = Math.hypot(ax - b.position.x, ay - b.position.y);
    const dAbort = Math.max(3.5, this.cellSizeCss * LATTICE_GLIDE_ABORT_MULT);
    if (dist > dAbort) {
      this.cancelLatticeGlide(r);
      return;
    }

    const dSnap = Math.max(0.55, this.cellSizeCss * LATTICE_GLIDE_SNAP_MULT);
    if (dist < dSnap) {
      this.finishLatticeGlide(r);
      return;
    }

    // Lazy-init the glide segment: capture start position the first frame and derive a duration
    // scaled by both the straight-line distance AND the outward component of the start velocity
    // (so a tile that's still coasting outward gets enough time to swing out, slow, and return).
    if (r.latticeGlideDurationMs <= 0) {
      r.latticeGlideStartX = b.position.x;
      r.latticeGlideStartY = b.position.y;
      // Start velocity is captured in `enterLatticeGlide` (or 0 for spawn) — don't overwrite here.
      r.latticeGlideElapsedMs = 0;
      const startDist = Math.hypot(ax - b.position.x, ay - b.position.y) || 1;
      const ux = (ax - r.latticeGlideStartX) / startDist;
      const uy = (ay - r.latticeGlideStartY) / startDist;
      // Outward speed (px/ms): positive when velocity points away from the anchor. The cubic
      // Hermite naturally "overshoots" by ~ v0·D/6 in that case, so we extend duration enough to
      // accommodate that travel without it visibly compressing the controlled return part.
      const outwardSpeed = Math.max(0, -(r.latticeGlideStartVx * ux + r.latticeGlideStartVy * uy));
      const overshootBudgetPx = outwardSpeed * 280;
      // Spawn vs post-release use independently tunable target speeds and duration bounds.
      const speed = r.latticeGlideIsSpawn
        ? LATTICE_GLIDE_SPAWN_TARGET_SPEED_PX_PER_S
        : LATTICE_GLIDE_TARGET_SPEED_PX_PER_S;
      const minDur = r.latticeGlideIsSpawn
        ? LATTICE_GLIDE_SPAWN_MIN_DURATION_MS
        : LATTICE_GLIDE_MIN_DURATION_MS;
      const maxDur = r.latticeGlideIsSpawn
        ? LATTICE_GLIDE_SPAWN_MAX_DURATION_MS
        : LATTICE_GLIDE_MAX_DURATION_MS;
      const desired = ((startDist + overshootBudgetPx) / speed) * 1000;
      r.latticeGlideDurationMs = Math.min(maxDur, Math.max(minDur, desired));
    }

    r.latticeGlideElapsedMs += deltaMs;
    const sx = r.latticeGlideStartX;
    const sy = r.latticeGlideStartY;
    const D = r.latticeGlideDurationMs;
    const t = Math.max(0, Math.min(1, r.latticeGlideElapsedMs / D));
    // Cubic Hermite p(t) = h00·p0 + h10·m0 + h01·p1 + h11·m1 with end velocity v1 = 0.
    // m0 is the start tangent in t-space: m0 = v0_px_per_ms · D. With v0 = 0 (spawn case) this
    // reduces exactly to the smoothstep 3t²−2t³ — so spawn behavior is unchanged. With outward v0
    // (post-coast field push) the curve preserves the body's existing velocity, decelerates it
    // smoothly, reverses, and lands at the anchor with v=0. No velocity discontinuity → no jerk.
    const tt = t * t;
    const ttt = tt * t;
    const h00 = 2 * ttt - 3 * tt + 1;
    const h10 = ttt - 2 * tt + t;
    const h01 = -2 * ttt + 3 * tt;
    const m0x = r.latticeGlideStartVx * D;
    const m0y = r.latticeGlideStartVy * D;
    const x = h00 * sx + h10 * m0x + h01 * ax;
    const y = h00 * sy + h10 * m0y + h01 * ay;
    Body.setPosition(b, { x, y });
    // Decay angle on a matching ease-out (smoothstep portion only is sufficient for visuals).
    const e = h01;
    Body.setAngle(b, b.angle * (1 - e * 0.95));
    Body.setVelocity(b, { x: 0, y: 0 });
    Body.setAngularVelocity(b, 0);
  }

  /** After physics: snap / stuck-timeout — uses post-collision distance. */
  private finalizeLatticeGlideAfterPhysics(
    r: LetterRecord,
    dragged: Body | null | undefined,
    _deltaMs: number,
  ): void {
    if (!r.latticeGlide) return;
    const b = r.body;
    if (dragged === b) {
      this.cancelLatticeGlide(r);
      return;
    }
    if (r.anchorPhase !== 'bound') {
      this.cancelLatticeGlide(r);
      return;
    }

    this.syncRecordAnchorToLayout(r);
    const ax = r.anchorX;
    const ay = r.anchorY;
    const dist = Math.hypot(ax - b.position.x, ay - b.position.y);
    const dAbort = Math.max(3.5, this.cellSizeCss * LATTICE_GLIDE_ABORT_MULT);
    if (dist > dAbort) {
      this.cancelLatticeGlide(r);
      return;
    }

    const dSnap = Math.max(0.4, this.cellSizeCss * LATTICE_GLIDE_SNAP_MULT);
    if (dist < dSnap) {
      this.finishLatticeGlide(r);
      return;
    }
    // `applyLatticeGlideBeforePhysics` drives the curve and advances `latticeGlideElapsedMs`. We
    // finish the glide either by curve completion (`elapsed >= duration`) or by the absolute MAX_MS
    // safety net.
    r.latticeGlideLastDist = dist;
    const segmentDone =
      r.latticeGlideDurationMs > 0 && r.latticeGlideElapsedMs >= r.latticeGlideDurationMs;
    if (segmentDone || r.latticeGlideElapsedMs >= LATTICE_GLIDE_MAX_MS) {
      this.finishLatticeGlide(r);
      return;
    }
  }

  private beginReturningPhase(r: LetterRecord): void {
    const b = r.body;
    r.anchorPhase = 'returning';
    r.floorDwellMs = 0;
    r.offAnchorStillMs = 0;
    r.airStuckMs = 0;
    r.tetherSettleMs = 0;
    r.latticeGlide = false;
    this.removeAnchorTether(r);
    this.resetGlideProgress(r);
    b.collisionFilter = letterFilterWallsOnly();
    Body.setVelocity(b, { x: 0, y: 0 });
    Body.setAngularVelocity(b, 0);
    Body.setStatic(b, true);
  }

  /** Kinematic homing has brought the tile inside the outer handoff zone; continue with visual glide (no tether). */
  private transitionReturningToBound(r: LetterRecord): void {
    const b = r.body;
    if (r.anchorPhase !== 'returning') return;
    this.removeAnchorTether(r);
    this.syncRecordAnchorToLayout(r);
    Body.setAngle(b, 0);
    Body.setVelocity(b, { x: 0, y: 0 });
    Body.setAngularVelocity(b, 0);
    r.anchorPhase = 'bound';
    r.floorDwellMs = 0;
    r.touchingFloor = false;
    r.touchingSupport = false;
    r.offAnchorStillMs = 0;
    r.airStuckMs = 0;
    r.tetherSettleMs = 0;
    this.enterLatticeGlide(r);
  }

  /**
   * `returning` uses `letterFilterWallsOnly` so letters don’t collide with the pile.
   */
  private stepReturningHoming(deltaMs: number): void {
    const dragged = this.mouseGrabLetterBody();
    const k0 = 1 - Math.exp(-HOMING_LAMBDA * (deltaMs / 1000));
    const releaseDist = RELEASE_DIST_MULT * this.cellSizeCss;
    const tetherZone = Math.max(
      8,
      Math.min(
        this.cellSizeCss * HOMING_TETHER_HANDOFF_CELL_MULT,
        releaseDist * HOMING_TETHER_HANDOFF_RELEASE_FRAC,
      ),
    );
    const slowBand = Math.max(tetherZone * 2.1, releaseDist * HOMING_SLOW_OUTER_FRAC);

    for (const r of this.letterRecords) {
      if (r.anchorPhase !== 'returning') continue;
      const b = r.body;
      if (dragged === b) continue;

      const easeR = this.boxHomingEase(r);
      if (easeR <= 0) {
        continue;
      }

      this.syncRecordAnchorToLayout(r);
      const ax = r.anchorX;
      const ay = r.anchorY;
      const distBefore = Math.hypot(ax - b.position.x, ay - b.position.y);
      let stepScale = 1;
      if (distBefore < slowBand) {
        const t = slowBand > 1e-6 ? distBefore / slowBand : 0;
        stepScale = HOMING_NEAR_STEP_SCALE + (1 - HOMING_NEAR_STEP_SCALE) * t;
      }
      const k = k0 * stepScale * easeR;
      const x = b.position.x + (ax - b.position.x) * k;
      const y = b.position.y + (ay - b.position.y) * k;
      Body.setPosition(b, { x, y });
      Body.setVelocity(b, { x: 0, y: 0 });
      Body.setAngularVelocity(b, 0);
      Body.setAngle(b, 0);

      const d = Math.hypot(ax - x, ay - y);
      const glideHandoffR = Math.max(
        tetherZone,
        this.cellSizeCss * LATTICE_GLIDE_RETURNING_HANDOFF_MULT,
      );
      if (d < glideHandoffR) this.transitionReturningToBound(r);
    }
  }

  private updateAnchorMotionAfterStep(deltaMs: number): void {
    const dragged = this.mouseGrabLetterBody();

    for (const r of this.letterRecords) {
      const b = r.body;

      if (r.anchorPhase === 'falling') {
        const spd = Math.hypot(b.velocity.x, b.velocity.y);
        const slowEnough = spd < REST_SPEED_MAX;
        const onPhysicsFloor = r.touchingFloor;
        const inRestZone = !b.isStatic && slowEnough && onPhysicsFloor;
        if (inRestZone) {
          if (!this.isDraggingBox()) {
            r.floorDwellMs += deltaMs;
          }
          if (r.floorDwellMs >= RETURN_DELAY_MS) {
            this.beginReturningPhase(r);
          }
        } else {
          r.floorDwellMs = 0;
        }

        if (!b.isStatic && !r.touchingFloor) {
          /** Letter-on-letter rest sets `touchingSupport`; that is not “air”, so do not snap homing via air-stuck. */
          if (r.touchingSupport) {
            r.airStuckMs = 0;
          } else {
            const airSpd = Math.hypot(b.velocity.x, b.velocity.y);
            if (
              airSpd < FALLING_AIR_STUCK_SPEED &&
              Math.abs(b.angularVelocity) < REASSEMBLY_ANG_MAX
            ) {
              if (!this.isDraggingBox()) {
                r.airStuckMs += deltaMs;
              }
              if (r.airStuckMs >= FALLING_AIR_STUCK_MS) {
                r.airStuckMs = 0;
                this.beginReturningPhase(r);
              }
            } else {
              r.airStuckMs = 0;
            }
          }
        } else {
          r.airStuckMs = 0;
        }
      }

      this.tryReleaseFromMotion(r, dragged);
      this.tryForceReassembleIfStill(r, deltaMs, dragged);
      if (r.anchorPhase === 'bound' && !r.body.isStatic && dragged !== r.body) {
        this.maybeForceSnapBoundWhenStuck(r, deltaMs, dragged);
        this.maybeSettleBoundWhenQuietOffHome(r, deltaMs, dragged);
        this.maybeBeginLatticeGlide(r, dragged);
      }
      if (r.latticeGlide) {
        this.finalizeLatticeGlideAfterPhysics(r, dragged, deltaMs);
        this.maybeRespawnLetterIfOffAnchorTooLong(r, deltaMs, dragged);
        continue;
      }
      this.maybeCommitBoundToLocked(r, deltaMs, dragged);
      this.maybeRespawnLetterIfOffAnchorTooLong(r, deltaMs, dragged);
    }
  }

  private enforceLetterBounds(css: { cw: number; ch: number }): void {
    const half = this.cellSizeCss * 0.5;
    const pad = BOUNDS_PAD_CSS;
    let minCx = half + pad;
    let minCy = half + pad;
    let maxCx = css.cw - half - pad;
    if (minCx > maxCx) {
      const mid = css.cw * 0.5;
      minCx = mid;
      maxCx = mid;
    }

    for (const r of this.letterRecords) {
      const b = r.body;
      if (b.isStatic || r.anchorPhase === 'bound') continue;

      let { x, y } = b.position;
      const vx = b.velocity.x;
      const vy = b.velocity.y;
      let clamped = false;

      if (x < minCx) {
        x = minCx;
        clamped = true;
        if (vx < 0) Body.setVelocity(b, { x: 0, y: vy });
      } else if (x > maxCx + this.cellSizeCss * 2) {
        x = maxCx + this.cellSizeCss * 2;
        clamped = true;
        if (vx > 0) Body.setVelocity(b, { x: 0, y: vy });
      }

      if (y < minCy) {
        y = minCy;
        clamped = true;
        const v = b.velocity;
        if (vy < 0) Body.setVelocity(b, { x: v.x, y: 0 });
      }

      if (clamped) {
        Body.setPosition(b, { x, y });
      }
    }
  }

  private recoverBrokenBodies(): void {
    for (const r of this.letterRecords) {
      const b = r.body;
      const { x, y } = b.position;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(b.angle)) {
        this.removeAnchorTether(r);
        this.syncRecordAnchorToLayout(r);
        b.collisionFilter = letterFilterFull();
        if (b.isStatic) Body.setStatic(b, false);
        Body.setPosition(b, { x: r.anchorX, y: r.anchorY });
        Body.setAngle(b, 0);
        Body.setVelocity(b, { x: 0, y: 0 });
        Body.setAngularVelocity(b, 0);
        r.anchorPhase = 'bound';
        r.floorDwellMs = 0;
        r.touchingFloor = false;
        r.touchingSupport = false;
        r.offAnchorStillMs = 0;
        r.airStuckMs = 0;
        r.tetherSettleMs = 0;
        r.lastBoxInteractPerf = -1;
        r.latticeGlide = false;
        r.offAnchorRespawnMs = 0;
        this.resetGlideProgress(r);
        this.ensureAnchorTether(r);
      }
    }
  }

  /**
   * After {@link OFF_ANCHOR_RESPAWN_MS} away from the layout anchor, destroy the Matter body and
   * Pixi cell and spawn a fresh **dynamic** tile at the anchor with its tether attached. Last-resort
   * recovery for cells that genuinely got stuck off-anchor; never makes the body static.
   */
  private respawnLetterAtAnchor(r: LetterRecord): void {
    this.removeAnchorTether(r);
    const oldBody = r.body;
    this.releaseMouseConstraintIfDraggingBody(oldBody);

    const gIdx = this.root.getChildIndex(r.g);
    Composite.remove(this.engine.world, oldBody);
    r.g.destroy({ children: true });

    this.syncRecordAnchorToLayout(r);
    const ax = r.anchorX;
    const ay = r.anchorY;

    const body = Bodies.rectangle(ax, ay, this.cellSizeCss, this.cellSizeCss, {
      isStatic: false,
      friction: 0.5,
      frictionAir: 0.014,
      restitution: 0.32,
      density: LETTER_BODY_DENSITY,
      label: LETTER_LABEL,
      collisionFilter: letterFilterFull(),
    });
    Composite.add(this.engine.world, body);

    const g = new Graphics();
    const insertAt = Math.max(0, Math.min(gIdx, this.root.children.length));
    this.root.addChildAt(g, insertAt);

    r.body = body;
    r.g = g;
    r.anchorPhase = 'bound';
    r.floorDwellMs = 0;
    r.touchingFloor = false;
    r.touchingSupport = false;
    r.offAnchorStillMs = 0;
    r.airStuckMs = 0;
    r.tetherSettleMs = 0;
    r.lastBoxInteractPerf = -1;
    r.latticeGlide = false;
    r.offAnchorRespawnMs = 0;
    this.resetGlideProgress(r);
    this.ensureAnchorTether(r);
  }

  private maybeRespawnLetterIfOffAnchorTooLong(
    r: LetterRecord,
    deltaMs: number,
    dragged: Body | null | undefined,
  ): void {
    const b = r.body;
    if (dragged === b) {
      r.offAnchorRespawnMs = 0;
      return;
    }
    this.syncRecordAnchorToLayout(r);
    const atHome = Math.max(1.5, this.cellSizeCss * REASSEMBLY_DIST_EPS_MULT);
    const dist = Math.hypot(r.anchorX - b.position.x, r.anchorY - b.position.y);
    if (dist <= atHome) {
      r.offAnchorRespawnMs = 0;
      return;
    }
    if (this.boxHomingEase(r) < 1) {
      r.offAnchorRespawnMs = 0;
      return;
    }
    r.offAnchorRespawnMs += deltaMs;
    if (r.offAnchorRespawnMs < OFF_ANCHOR_RESPAWN_MS) return;
    r.offAnchorRespawnMs = 0;
    this.respawnLetterAtAnchor(r);
  }

  update(deltaMs: number) {
    const dt = Math.min(deltaMs, ENGINE_DELTA_CAP_MS);
    this.syncViewportAnchorCache();
    if (this.primaryPointerDownOnCanvas) {
      (this.mouse as MouseWithButton).button = 0;
    }
    if (this.lastPointerCanvasCss) {
      this.syncMatterMouseToCanvasCss(this.lastPointerCanvasCss);
    }
    this.syncMouseConstraintPickCollisionFilter();
    this.clearLetterMouseGrabIfDisabled();
    this.suppressMisalignedLetterMouseGrab();
    this.updateBoundTetherStrength();
    this.applyPointerFieldBeforeStep(dt);
    this.boundAngularDampBeforeStep();
    this.clearDynamicFloorContact();
    const draggedPre = this.mouseGrabLetterBody();
    for (const r of this.letterRecords) {
      if (r.latticeGlide) this.applyLatticeGlideBeforePhysics(r, draggedPre, dt);
    }
    Engine.update(this.engine, dt);
    this.clearLetterMouseGrabIfDisabled();
    this.suppressMisalignedLetterMouseGrab();
    this.updateAnchorMotionAfterStep(dt);
    this.stepReturningHoming(dt);
    this.enforceLetterBounds(getPhysicsViewport(this.app));
    this.recoverBrokenBodies();

    const { sx, sy } = cssPixelsToPixiFactors(this.app);
    const side = this.cellSizeCss;
    for (const r of this.letterRecords) {
      const b = r.body;
      const g = r.g;
      g.rotation = b.angle;
      const px = Number.isFinite(b.position.x) ? b.position.x : r.anchorX;
      const py = Number.isFinite(b.position.y) ? b.position.y : r.anchorY;
      g.position.set(px * sx, py * sy);
      g.clear();
      g.rect(-side * 0.5 * sx, -side * 0.5 * sy, side * sx, side * sy);
      const fillAlpha = b.isSleeping ? 0.78 : 0.92;
      g.fill({ color: 0x4c5d9f, alpha: fillAlpha });
      g.stroke({ width: Math.max(1, sx), color: 0x1a2033, alpha: 0.7 });
    }
  }

  dispose() {
    this.onWindowPointerEnd();
    window.removeEventListener('pointerup', this.onWindowPointerEnd);
    window.removeEventListener('pointercancel', this.onWindowPointerEnd);
    window.removeEventListener('pointermove', this.onWindowPointerMoveWhileDown);
    const canvas = this.app.canvas;
    canvas.removeEventListener('pointermove', this.onCanvasPointerMove);
    canvas.removeEventListener('pointerleave', this.onCanvasPointerLeave);
    canvas.removeEventListener('pointerdown', this.onCanvasPointerDown);
    window.removeEventListener('resize', this.resizeHandler);
    window.removeEventListener('orientationchange', this.resizeHandler);
    Events.off(this.mouseConstraint, 'startdrag', this.onDragStart);
    Events.off(this.mouseConstraint, 'enddrag', this.onDragEnd);
    Events.off(this.engine, 'collisionStart', this.onCollisionStart);
    Events.off(this.engine, 'collisionActive', this.onCollisionActive);
    for (const r of this.letterRecords) {
      this.removeAnchorTether(r);
    }
    Composite.remove(this.engine.world, this.mouseConstraint);
    Composite.clear(this.engine.world, false);
    Engine.clear(this.engine);
    this.letterRecords.forEach((r) => r.g.destroy());
    this.letterRecords = [];
    this.walls = [];
    this.root.destroy({ children: true });
  }

  viewportCss(): { cw: number; ch: number } {
    return getPhysicsViewport(this.app);
  }

  pixiDimensions(): { w: number; h: number } {
    return {
      w: this.app.renderer.width,
      h: this.app.renderer.height,
    };
  }

  private relayout(css: { cw: number; ch: number }) {
    let cw = css.cw;
    let ch = css.ch;
    const MIN_DIM = 48;
    if (cw < MIN_DIM || ch < MIN_DIM) {
      if (this.lastValidViewport) {
        cw = this.lastValidViewport.cw;
        ch = this.lastValidViewport.ch;
      } else {
        return;
      }
    } else {
      this.lastValidViewport = { cw, ch };
    }

    for (const w of this.walls) {
      Composite.remove(this.engine.world, w);
    }
    this.walls = [];

    const floor = Bodies.rectangle(
      cw / 2,
      ch + WALL_THICK / 2,
      cw + WALL_THICK * 10,
      WALL_THICK,
      {
        isStatic: true,
        label: FLOOR_LABEL,
        friction: 0.28,
        restitution: 0.42,
        collisionFilter: {
          category: WALL_CATEGORY,
          mask: LETTER_CATEGORY | WALL_CATEGORY,
        },
      }
    );
    const ceil = Bodies.rectangle(cw / 2, -WALL_THICK * 6, cw + WALL_THICK * 14, WALL_THICK, {
      isStatic: true,
      label: WALL_LABEL,
      friction: 0.08,
      restitution: 0.12,
      collisionFilter: {
        category: WALL_CATEGORY,
        mask: LETTER_CATEGORY | WALL_CATEGORY,
      },
    });
    const left = Bodies.rectangle(-WALL_THICK / 2, ch / 2, WALL_THICK, ch * 3 + 400, {
      isStatic: true,
      label: WALL_LABEL,
      friction: 0.22,
      restitution: 0.18,
      collisionFilter: {
        category: WALL_CATEGORY,
        mask: LETTER_CATEGORY | WALL_CATEGORY,
      },
    });
    const right = Bodies.rectangle(cw + WALL_THICK / 2, ch / 2, WALL_THICK, ch * 3 + 400, {
      isStatic: true,
      label: WALL_LABEL,
      friction: 0.22,
      restitution: 0.18,
      collisionFilter: {
        category: WALL_CATEGORY,
        mask: LETTER_CATEGORY | WALL_CATEGORY,
      },
    });

    this.walls.push(floor, ceil, left, right);
    Composite.add(this.engine.world, this.walls);

    if (this.letterRecords.length === 0) {
      this.spawnLetterGrid(css);
    } else if (!this.layoutFrozen) {
      this.rebuildLetterMosaic(css);
    } else {
      this.refreshAnchorsFromLayout(css);
    }
  }

  private clearLetterBodies() {
    for (const r of this.letterRecords) {
      this.removeAnchorTether(r);
      Composite.remove(this.engine.world, r.body);
      r.g.destroy();
    }
    this.letterRecords = [];
  }

  private rebuildLetterMosaic(css: { cw: number; ch: number }) {
    this.clearLetterBodies();
    this.spawnLetterGrid(css);
  }

  private refreshAnchorsFromLayout(css: { cw: number; ch: number }) {
    const layout = layoutSourcehiveInViewport(css.cw, css.ch, LAYOUT_FRAC_Y);
    this.fillAnchorCacheFromLayout(layout);
    for (const r of this.letterRecords) {
      const p = this.anchorLayoutCache.get(`${r.gx},${r.gy}`);
      if (!p) continue;
      r.anchorX = p.x;
      r.anchorY = p.y;
      if (r.anchorTether) {
        r.anchorTether.pointA.x = p.x;
        r.anchorTether.pointA.y = p.y;
      }
      // Tether will pull dynamic bodies back to the new anchor automatically.
    }
  }

  private spawnLetterGrid(css: { cw: number; ch: number }) {
    const layout = layoutSourcehiveInViewport(css.cw, css.ch, LAYOUT_FRAC_Y);
    this.fillAnchorCacheFromLayout(layout);
    let order = 0;
    // Per-tile randomized scatter inside the lattice-glide range, then the SAME `applyLatticeGlideBeforePhysics`
    // that does the final snap lerps each tile onto its anchor. Spawn distance must stay below
    // `LATTICE_GLIDE_ABORT_MULT * cellSizeCss` (~7×) or the glide aborts before completing.
    const scatterMin = this.cellSizeCss * 1.5;
    const scatterMax = this.cellSizeCss * 5.5;
    for (const t of layout.tiles) {
      const ang = Math.random() * Math.PI * 2;
      const dist = scatterMin + Math.random() * (scatterMax - scatterMin);
      const sx = t.x + Math.cos(ang) * dist;
      const sy = t.y + Math.sin(ang) * dist;
      const body = Bodies.rectangle(sx, sy, this.cellSizeCss, this.cellSizeCss, {
        isStatic: false,
        friction: 0.5,
        frictionAir: 0.014,
        restitution: 0.32,
        density: LETTER_BODY_DENSITY,
        label: LETTER_LABEL,
        collisionFilter: letterFilterWallsOnly(),
      });
      Body.setVelocity(body, { x: 0, y: 0 });
      Body.setAngularVelocity(body, 0);
      Composite.add(this.engine.world, body);

      const g = new Graphics();
      this.root.addChild(g);
      const rec: LetterRecord = {
        body,
        g,
        order,
        gx: t.gx,
        gy: t.gy,
        anchorX: t.x,
        anchorY: t.y,
        anchorPhase: 'bound',
        floorDwellMs: 0,
        touchingFloor: false,
        touchingSupport: false,
        offAnchorStillMs: 0,
        airStuckMs: 0,
        tetherSettleMs: 0,
        lastBoxInteractPerf: -1,
        anchorTether: null,
        latticeGlideStuckMs: 0,
        latticeGlideLowMotionMs: 0,
        latticeGlideLastDist: -1,
        latticeGlideElapsedMs: 0,
        latticeGlideStartX: sx,
        latticeGlideStartY: sy,
        latticeGlideStartVx: 0,
        latticeGlideStartVy: 0,
        latticeGlideDurationMs: 0,
        latticeGlideIsSpawn: true,
        boundStuckMs: 0,
        boundLowMotionMs: 0,
        quietOffHomeMs: 0,
        offAnchorRespawnMs: 0,
        boundStuckLastDist: -1,
        latticeGlide: true,
      };
      this.letterRecords.push(rec);
      order += 1;
    }
    this.layoutFrozen = true;
  }
}

/** Physics and layout use CSS pixels; keep mouse pixelRatio neutral so constraints match bodies. */
function syncMouseDpi(mouse: Mouse, _canvas: HTMLCanvasElement) {
  mouse.pixelRatio = 1;
}
