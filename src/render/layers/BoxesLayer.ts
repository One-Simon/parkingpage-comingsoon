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

/**
 * Static tiles wake only when the user’s dragged tile overlaps them, or when another dynamic
 * letter hits hard enough. Removed: “closing + penetration” wake on collisionActive (lattice ignition).
 */
const WAKE_SLOP_EPS = 0.015;

/** If a dynamic letter hits a static one at least this fast, wake target straight into `falling`. */
const HIT_RELEASE_SPEED = 1.15;

const GRAVITY = { x: 0, y: 0.32, scale: 0.00065 };

const MOUSE_CONSTRAINT_STIFFNESS = 0.987;
const MOUSE_CONSTRAINT_DAMPING = 0.19;

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
 * When stamping neighbors after a grab, use a disc larger than {@link POINTER_REPULSE_RADIUS_CSS} so
 * chain‑pushed boxes still get a tether cooldown (avoids full‑strength tether the frame repulsion stops).
 */
const POINTER_SESSION_STAMP_RADIUS_MULT = 2.2;

/**
 * Anchor tether: soft near the lattice rest pose; strength ramps with distance using
 * {@link TETHER_RAMP_DIST_MULT} (not break distance {@link RELEASE_DIST_MULT}).
 */
const TETHER_STIFFNESS_NEAR = 0.00116;
const TETHER_STIFFNESS_FAR = 0.0062;
const TETHER_DAMPING_NEAR = 0.00385;
const TETHER_DAMPING_FAR = 0.0088;

/**
 * Within this many × cell size from anchor, blend tether toward “relaxed” so collisions can
 * re-seat tiles against neighbors without the constraint fighting the pile.
 */
const TETHER_RELAX_RADIUS_MULT = 0.52;
const TETHER_STIFFNESS_RELAX = 0.00011;
const TETHER_DAMPING_RELAX = 0.0024;

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
 * Final approach: kinematic lerp toward anchor, **full** letter–letter collisions so the pile stays
 * rigid; no anchor tether. Canceled by user grab / large anchor mismatch only — not pointer repulsion.
 */
const LATTICE_GLIDE_ENTER_MULT = 1.12;
/** `returning` kinematic homing hands off to glide when closer than this × cell (larger = sooner). */
const LATTICE_GLIDE_RETURNING_HANDOFF_MULT = 5.45;
const LATTICE_GLIDE_SNAP_MULT = 0.032;
/** Exponential approach; moderate = smoother motion (smoothstep applied on top). */
const LATTICE_GLIDE_LAMBDA = 11;
/**
 * Abort glide and restore tether if farther than this × cell from anchor (must exceed handoff radii).
 */
const LATTICE_GLIDE_ABORT_MULT = 7.15;
/** No meaningful progress toward anchor while gliding → {@link BoxesLayer.finishLatticeGlide} snap. */
const LATTICE_GLIDE_STUCK_MS = 420;
const LATTICE_GLIDE_STUCK_DIST_EPS = 0.38;
/**
 * Glide tile shows almost no Matter motion but remains off-slot (blocked) → finish visual glide.
 */
const LATTICE_GLIDE_LOW_MOTION_SPD = 0.072;
const LATTICE_GLIDE_LOW_MOTION_ANG = 0.038;
const LATTICE_GLIDE_LOW_MOTION_MS = 360;
const LATTICE_GLIDE_MAX_MS = 4800;
/** Locked mosaic cells should match layout; snap when numerical / collision drift exceeds this × cell. */
const LOCKED_ANCHOR_HEAL_MULT = 0.04;
/** Run locked-anchor heal at most this often (ms) to avoid per-frame layout/body work. */
const HEAL_LOCKED_INTERVAL_MS = 180;

/**
 * While the primary button is down but the mouse constraint has not attached yet, scale tether
 * strength for bodies under the pointer so the anchor pull doesn’t “outrun” fat-finger grab.
 */
const PRE_GRAB_POINTER_TETHER_MULT = 0.14;

/** Pointer disc (CSS px): dynamic letters are nudged outward while primary button is held. */
const POINTER_REPULSE_RADIUS_CSS = 94;
/** Peak repulsion force (Matter units); scaled by falloff inside the disc. */
const POINTER_REPULSE_FORCE = 0.00063;
/** Blend: linear+quadratic falloff so mid-disc push is stronger than pure edge². */
const POINTER_REPULSE_FALLOFF_LINEAR = 0.3;
/**
 * Pointer travel (Matter px) in one physics step: below {@link POINTER_REPULSE_MOVE_EPS} uses
 * {@link POINTER_REPULSE_STATIONARY_MULT}; at/above {@link POINTER_REPULSE_MOVE_FULL} repulsion is full strength.
 */
const POINTER_REPULSE_MOVE_EPS = 0.32;
const POINTER_REPULSE_MOVE_FULL = 4.5;
/** Repulsion scale when the grabbed cursor is effectively stationary (small residual cushion). */
const POINTER_REPULSE_STATIONARY_MULT = 0.12;

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

type AnchorPhase = 'locked' | 'bound' | 'falling' | 'returning';

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

/**
 * Pointer “disc” hit: expanded AABB test first (cheap), then exact polygon test (rotated tiles).
 */
function letterPointerHitDisc(pt: { x: number; y: number }, radius: number, body: Body): boolean {
  const { min, max } = body.bounds;
  if (circleIntersectsAabb(pt.x, pt.y, radius, min.x, min.y, max.x, max.y)) return true;
  const start = body.parts.length > 1 ? 1 : 0;
  for (let i = start; i < body.parts.length; i++) {
    if (Vertices.contains(body.parts[i].vertices, pt)) return true;
  }
  return false;
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
  /** Descending `order` for pointer pick (avoids sorting every wake/grab). */
  private recordsPickSorted: LetterRecord[] = [];
  private healLockedAccumMs = 0;

  private primaryPointerDownOnCanvas = false;
  /** Set when canvas uses Pointer Capture so move/up follow the finger reliably. */
  private pointerCaptureId: number | null = null;

  /** Previous pointer position for motion-aware repulsion while dragging. */
  private repulsePointerPrevX = Number.NaN;
  private repulsePointerPrevY = Number.NaN;

  private readonly onWindowPointerEnd: () => void;
  private readonly onWindowPointerMoveWhileDown: (ev: PointerEvent) => void;

  private lastValidViewport: { cw: number; ch: number } | null = null;

  /**
   * True when the mouse constraint is pulling a **mosaic box** body (one `LetterRecord` cell), not
   * a “letter” glyph. Letters in the UI are made of many such boxes.
   */
  private isDraggingBox(): boolean {
    const b = this.mouseConstraint.body;
    return b != null && b.label === LETTER_LABEL;
  }

  /** Radius for repulsion “bulge” while a box is grabbed (CSS-ish px, Matter space). */
  private pointerRepulsionRadiusPx(): number {
    return Math.max(POINTER_REPULSE_RADIUS_CSS, this.cellSizeCss * 3.45);
  }

  /** Larger disc: stamp `lastBoxInteractPerf` for bound boxes so tether eases after pointer session ends. */
  private pointerSessionStampRadiusPx(): number {
    return this.pointerRepulsionRadiusPx() * POINTER_SESSION_STAMP_RADIUS_MULT;
  }

  /**
   * Marks bound, dynamic boxes under the pointer disc so {@link boxHomingEase} restarts — same clock
   * used when repulsion stops, avoiding an instant jump to full tether for pile neighbors.
   */
  private refreshBoxInteractCooldownNearPointer(now = performance.now()): number {
    const pt = this.mouse.position;
    const R = this.pointerSessionStampRadiusPx();
    let n = 0;
    for (const r of this.letterRecords) {
      if (r.anchorPhase !== 'bound' || r.body.isStatic) continue;
      if (!letterPointerHitDisc(pt, R, r.body)) continue;
      r.lastBoxInteractPerf = now;
      n++;
    }
    return n;
  }

  /**
   * Homing / anchor-tether scale from {@link LetterRecord.lastBoxInteractPerf} (grab + repulsion).
   * The grabbed box stays at 0 while `mouseConstraint` holds it.
   */
  private boxHomingEase(r: LetterRecord): number {
    const b = r.body;
    if (this.isDraggingBox() && this.mouseConstraint.body === b) return 0;
    if (r.lastBoxInteractPerf < 0) return 1;
    const dt = performance.now() - r.lastBoxInteractPerf;
    return Math.max(0, Math.min(1, dt / POST_INTERACT_HOME_RESUME_MS));
  }

  private syncMatterMouseToCanvasCss(p: { x: number; y: number }): void {
    const m = this.mouse as MouseWithButton;
    m.absolute.x = p.x;
    m.absolute.y = p.y;
    m.position.x = p.x * m.scale.x + m.offset.x;
    m.position.y = p.y * m.scale.y + m.offset.y;
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
        this.refreshBoxInteractCooldownNearPointer(performance.now());
      }
      this.primaryPointerDownOnCanvas = false;
      (this.mouse as MouseWithButton).button = -1;
      if (this.pointerCaptureId != null) {
        try {
          this.app.canvas.releasePointerCapture(this.pointerCaptureId);
        } catch {
          /* no-op */
        }
        this.pointerCaptureId = null;
      }
      for (const r of this.letterRecords) {
        if (r.anchorPhase === 'bound' && !r.body.isStatic) {
          this.ensureAnchorTether(r);
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
      for (const r of this.letterRecords) {
        if (r.body === b) continue;
        r.floorDwellMs = 0;
        r.airStuckMs = 0;
        r.offAnchorStillMs = 0;
      }
      const mp = this.mouse.position;
      this.repulsePointerPrevX = mp.x;
      this.repulsePointerPrevY = mp.y;
    };

    this.onDragEnd = (ev: IEvent<Manipulator>) => {
      const b = (ev as DragPayload).body;
      if (!b || b.label !== LETTER_LABEL) return;
      const rec = this.letterRecords.find((r) => r.body === b);
      if (rec && rec.anchorPhase === 'bound' && !rec.body.isStatic) {
        this.ensureAnchorTether(rec);
      }
      if (rec) {
        const now = performance.now();
        rec.lastBoxInteractPerf = now;
        this.refreshBoxInteractCooldownNearPointer(now);
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
      try {
        (ev.currentTarget as HTMLCanvasElement).setPointerCapture(ev.pointerId);
        this.pointerCaptureId = ev.pointerId;
      } catch {
        this.pointerCaptureId = null;
      }
      if (ev.pointerType === 'touch') {
        ev.preventDefault();
      }
      this.pickAndWakeLetterAtPointer();
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

  private pickAndWakeLetterAtPointer(): void {
    const m = this.mouse as MouseWithButton;
    const pt = { x: m.position.x, y: m.position.y };
    const r = this.pointerInteractionRadiusPx();
    for (const rec of this.recordsPickSorted) {
      const b = rec.body;
      if (b.label !== LETTER_LABEL || !b.isStatic) continue;
      if (!letterPointerHitDisc(pt, r, b)) continue;
      this.wakeLetter(b);
      return;
    }
  }

  /** Radius in Matter/CSS units for circular pointer pick + grab (scales with tile size). */
  private pointerInteractionRadiusPx(): number {
    return Math.max(POINTER_INTERACTION_RADIUS_CSS, this.cellSizeCss * 1.2);
  }

  /**
   * Matter’s MouseConstraint only grabs when the pointer lies inside the body polygon.
   * Before Engine.update, attach the constraint using the same circular region as pick/wake.
   */
  private tryFatFingerMouseGrab(): void {
    if (!this.primaryPointerDownOnCanvas) return;
    const mc = this.mouseConstraint;
    const c = mc.constraint;
    if ((this.mouse as MouseWithButton).button !== 0 || c.bodyB) return;

    const mouse = mc.mouse;
    const pt = mouse.position;
    const r = this.pointerInteractionRadiusPx();
    for (const rec of this.recordsPickSorted) {
      const body = rec.body;
      if (body.label !== LETTER_LABEL) continue;
      if (rec.anchorPhase === 'returning') continue;
      if (body.isStatic) continue;
      if (!Detector.canCollide(body.collisionFilter, mc.collisionFilter)) continue;

      if (!letterPointerHitDisc(pt, r, body)) continue;

      c.pointA = { x: pt.x, y: pt.y };
      c.bodyB = body;
      mc.body = body;
      c.pointB = { x: pt.x - body.position.x, y: pt.y - body.position.y };
      (c as ConstraintType & { angleB: number }).angleB = body.angle;
      Sleeping.set(body, false);
      Events.trigger(mc, 'startdrag', {
        mouse,
        body,
        name: 'startdrag',
        source: mc,
      } as IEvent<Manipulator>);
      return;
    }
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

  private rebuildRecordsPickOrder(): void {
    this.recordsPickSorted = [...this.letterRecords].sort((a, b) => b.order - a.order);
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
    const dragged = this.mouseConstraint.body;
    const dragging = this.isDraggingBox();
    const canvasPress = this.primaryPointerDownOnCanvas;
    const mouseDown = (this.mouse as MouseWithButton).button === 0;
    /** Matter can keep `mouseConstraint.body` for a frame or two after window pointerup — avoid stripping neighbor tethers then. */
    const allowNeighborTetherCut = dragging && canvasPress && mouseDown;
    const mcBodyB = this.mouseConstraint.constraint.bodyB;
    const preGrabLoosen =
      canvasPress && mouseDown && !dragging && !mcBodyB && this.primaryPointerDownOnCanvas;

    for (const r of this.letterRecords) {
      if (r.anchorPhase !== 'bound' || r.body.isStatic) continue;
      if (r.latticeGlide) continue;
      const b = r.body;
      if (dragged === b) continue;

      const cutNeighbor =
        allowNeighborTetherCut && dragged !== b && letterPointerHitDisc(pt, pickR, b);
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

      if (
        preGrabLoosen &&
        letterPointerHitDisc(pt, pickR * 1.15, b)
      ) {
        stiff *= PRE_GRAB_POINTER_TETHER_MULT;
        damp *= PRE_GRAB_POINTER_TETHER_MULT;
      }

      r.anchorTether.stiffness = stiff;
      r.anchorTether.damping = damp;
    }
  }
  private applyPointerRepulsionBeforeStep(): void {
    if (!this.isDraggingBox()) return;
    if ((this.mouse as MouseWithButton).button !== 0) return;
    const px = this.mouse.position.x;
    const py = this.mouse.position.y;
    let moveT = 0;
    if (Number.isFinite(this.repulsePointerPrevX) && Number.isFinite(this.repulsePointerPrevY)) {
      const moveDist = Math.hypot(px - this.repulsePointerPrevX, py - this.repulsePointerPrevY);
      const span = Math.max(POINTER_REPULSE_MOVE_FULL - POINTER_REPULSE_MOVE_EPS, 1e-6);
      moveT = Math.max(0, Math.min(1, (moveDist - POINTER_REPULSE_MOVE_EPS) / span));
    }
    this.repulsePointerPrevX = px;
    this.repulsePointerPrevY = py;
    const motionScale =
      POINTER_REPULSE_STATIONARY_MULT + (1 - POINTER_REPULSE_STATIONARY_MULT) * moveT;

    const R = this.pointerRepulsionRadiusPx();
    const dragged = this.mouseConstraint.body;
    const now = performance.now();

    for (const r of this.letterRecords) {
      const b = r.body;
      if (b.label !== LETTER_LABEL || b.isStatic || dragged === b) continue;
      if (r.anchorPhase === 'returning' || r.anchorPhase === 'falling') continue;
      if (r.latticeGlide) continue;

      const dx = b.position.x - px;
      const dy = b.position.y - py;
      const d = Math.hypot(dx, dy);
      if (d >= R || d < 1e-4) continue;
      const nx = dx / d;
      const ny = dy / d;
      const edge = 1 - d / R;
      const falloff =
        POINTER_REPULSE_FALLOFF_LINEAR * edge + (1 - POINTER_REPULSE_FALLOFF_LINEAR) * edge * edge;
      const mag = POINTER_REPULSE_FORCE * falloff * motionScale;
      Body.applyForce(b, b.position, { x: nx * mag, y: ny * mag });
      if (r.anchorPhase === 'bound') {
        r.lastBoxInteractPerf = now;
      }
    }
  }

  private boundAngularDampBeforeStep(): void {
    const dragged = this.mouseConstraint.body;
    for (const r of this.letterRecords) {
      const b = r.body;
      if (b.isStatic || r.anchorPhase !== 'bound' || dragged === b) continue;
      if (r.latticeGlide) continue;
      Body.setAngularVelocity(b, b.angularVelocity * BOUND_ANGLE_DAMP);
    }
  }

  private wakeLetter(b: Body): void {
    if (!b.isStatic) return;
    const rec = this.letterRecords.find((r) => r.body === b);
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
    Sleeping.set(b, false);
    Body.setStatic(b, false);
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
    Body.setVelocity(b, { x: 0, y: 0 });
    Body.setAngularVelocity(b, 0);
    this.layoutFrozen = true;
    if (rec) this.ensureAnchorTether(rec);
  }

  private canTransmitWakeToStaticLetter(other: Body): boolean {
    if (other.label === FLOOR_LABEL || other.label === WALL_LABEL) return false;
    if (other.label === LETTER_LABEL && other.isStatic) return false;
    return true;
  }

  private maybeWakeFromCollisionPair(pair: IEventCollision<Engine>['pairs'][number]): void {
    const dragged = this.mouseConstraint.body;
    const a = pair.bodyA;
    const b = pair.bodyB;
    const aStaticLetter = a.label === LETTER_LABEL && a.isStatic;
    const bStaticLetter = b.label === LETTER_LABEL && b.isStatic;
    if (aStaticLetter === bStaticLetter) return;

    const staticLetter = aStaticLetter ? a : b;
    const other = staticLetter === a ? b : a;
    if (!this.canTransmitWakeToStaticLetter(other)) return;

    const coll = pair.collision;
    const hasOverlap = coll.depth > pair.slop + WAKE_SLOP_EPS;
    if (!hasOverlap) return;

    const speed = Math.hypot(other.velocity.x, other.velocity.y);
    const wokenByPointer =
      other === dragged && dragged !== null && other.label === LETTER_LABEL && !other.isStatic;
    const wokenByHardHit =
      other.label === LETTER_LABEL && !other.isStatic && speed >= HIT_RELEASE_SPEED;

    if (!wokenByPointer && !wokenByHardHit) return;

    this.wakeLetter(staticLetter);

    const rec = this.letterRecords.find((r) => r.body === staticLetter);
    if (rec && wokenByHardHit) {
      rec.anchorPhase = 'falling';
      rec.floorDwellMs = 0;
      rec.offAnchorStillMs = 0;
      rec.airStuckMs = 0;
      rec.tetherSettleMs = 0;
      this.removeAnchorTether(rec);
    }
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

  private settleLetterAtAnchor(r: LetterRecord): void {
    const b = r.body;
    if (r.anchorPhase === 'locked') return;
    this.removeAnchorTether(r);
    this.syncRecordAnchorToLayout(r);
    b.collisionFilter = letterFilterFull();
    Body.setPosition(b, { x: r.anchorX, y: r.anchorY });
    Body.setAngle(b, 0);
    Body.setVelocity(b, { x: 0, y: 0 });
    Body.setAngularVelocity(b, 0);
    Body.setStatic(b, true);
    r.anchorPhase = 'locked';
    r.floorDwellMs = 0;
    r.touchingFloor = false;
    r.touchingSupport = false;
    r.offAnchorStillMs = 0;
    r.airStuckMs = 0;
    r.tetherSettleMs = 0;
    r.latticeGlide = false;
    r.offAnchorRespawnMs = 0;
    this.resetGlideProgress(r);
  }

  private tryReleaseFromMotion(rec: LetterRecord, dragged: Body | null | undefined): void {
    const b = rec.body;
    if (rec.anchorPhase !== 'bound' || b.isStatic || dragged === b) return;

    const dx = rec.anchorX - b.position.x;
    const dy = rec.anchorY - b.position.y;
    const dist = Math.hypot(dx, dy);
    const releaseDist = RELEASE_DIST_MULT * this.cellSizeCss;
    if (dist > releaseDist) {
      rec.latticeGlide = false;
      this.resetGlideProgress(rec);
      rec.anchorPhase = 'falling';
      rec.floorDwellMs = 0;
      rec.offAnchorStillMs = 0;
      rec.airStuckMs = 0;
      rec.tetherSettleMs = 0;
      this.removeAnchorTether(rec);
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
    if (r.anchorPhase === 'locked' || r.anchorPhase === 'returning') {
      r.offAnchorStillMs = 0;
      return;
    }

    if (r.anchorPhase === 'falling') {
      const grounded = r.touchingFloor || r.touchingSupport;
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

  private enterLatticeGlide(r: LetterRecord): void {
    const b = r.body;
    this.removeAnchorTether(r);
    b.collisionFilter = letterFilterFull();
    Sleeping.set(b, false);
    Body.setStatic(b, false);
    Body.setVelocity(b, { x: 0, y: 0 });
    Body.setAngularVelocity(b, 0);
    this.resetGlideProgress(r);
    r.latticeGlide = true;
  }

  private maybeBeginLatticeGlide(r: LetterRecord, dragged: Body | null | undefined): void {
    const b = r.body;
    if (r.latticeGlide || r.anchorPhase !== 'bound' || b.isStatic || dragged === b) return;
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

    const rawK = 1 - Math.exp(-LATTICE_GLIDE_LAMBDA * (deltaMs / 1000));
    const k = rawK * rawK * (3 - 2 * rawK);
    const x = b.position.x + (ax - b.position.x) * k;
    const y = b.position.y + (ay - b.position.y) * k;
    Body.setPosition(b, { x, y });
    Body.setAngle(b, b.angle * (1 - k * 0.88));
    Body.setVelocity(b, { x: 0, y: 0 });
    Body.setAngularVelocity(b, 0);
  }

  /** After physics: snap / stuck-timeout — uses post-collision distance. */
  private finalizeLatticeGlideAfterPhysics(
    r: LetterRecord,
    dragged: Body | null | undefined,
    deltaMs: number,
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

    const dSnap = Math.max(0.55, this.cellSizeCss * LATTICE_GLIDE_SNAP_MULT);
    if (dist < dSnap) {
      this.finishLatticeGlide(r);
      return;
    }

    r.latticeGlideElapsedMs += deltaMs;
    if (
      r.latticeGlideLastDist >= 0 &&
      Math.abs(dist - r.latticeGlideLastDist) < LATTICE_GLIDE_STUCK_DIST_EPS
    ) {
      r.latticeGlideStuckMs += deltaMs;
    } else {
      r.latticeGlideStuckMs = 0;
    }
    r.latticeGlideLastDist = dist;

    const spdG = Math.hypot(b.velocity.x, b.velocity.y);
    const angG = Math.abs(b.angularVelocity);
    const glideMicroStill =
      spdG < LATTICE_GLIDE_LOW_MOTION_SPD && angG < LATTICE_GLIDE_LOW_MOTION_ANG;
    if (glideMicroStill) {
      r.latticeGlideLowMotionMs += deltaMs;
    } else {
      r.latticeGlideLowMotionMs = 0;
    }

    const stuck = r.latticeGlideStuckMs >= LATTICE_GLIDE_STUCK_MS;
    const stuckLowMotion = r.latticeGlideLowMotionMs >= LATTICE_GLIDE_LOW_MOTION_MS;
    const timedOut = r.latticeGlideElapsedMs >= LATTICE_GLIDE_MAX_MS;
    if (stuck || stuckLowMotion || timedOut) {
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
    const dragged = this.mouseConstraint.body;
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
    const dragged = this.mouseConstraint.body;

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
        Body.setPosition(b, { x: r.anchorX, y: r.anchorY });
        Body.setAngle(b, 0);
        Body.setVelocity(b, { x: 0, y: 0 });
        Body.setAngularVelocity(b, 0);
        Body.setStatic(b, true);
        r.anchorPhase = 'locked';
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
      }
    }
  }

  /** Snap `locked` static tiles onto lattice anchors when they have drifted (jitter – rare). */
  private healLockedLettersToAnchors(deltaMs: number): void {
    this.healLockedAccumMs += deltaMs;
    if (this.healLockedAccumMs < HEAL_LOCKED_INTERVAL_MS) return;
    this.healLockedAccumMs = 0;
    const eps = Math.max(0.35, this.cellSizeCss * LOCKED_ANCHOR_HEAL_MULT);
    for (const r of this.letterRecords) {
      if (r.anchorPhase !== 'locked' || !r.body.isStatic) continue;
      this.syncRecordAnchorToLayout(r);
      const d = Math.hypot(r.anchorX - r.body.position.x, r.anchorY - r.body.position.y);
      if (d <= eps) continue;
      Body.setPosition(r.body, { x: r.anchorX, y: r.anchorY });
      Body.setAngle(r.body, 0);
      Body.setVelocity(r.body, { x: 0, y: 0 });
      Body.setAngularVelocity(r.body, 0);
    }
  }

  /**
   * After {@link OFF_ANCHOR_RESPAWN_MS} away from the layout anchor, destroy the Matter body and
   * Pixi cell and spawn a fresh locked tile at the anchor (last-resort recovery).
   */
  private respawnLetterLockedAtAnchor(r: LetterRecord): void {
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
      isStatic: true,
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
    r.anchorPhase = 'locked';
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
    if (r.anchorPhase === 'locked' && b.isStatic) {
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
    this.respawnLetterLockedAtAnchor(r);
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
    if (this.primaryPointerDownOnCanvas && this.lastPointerCanvasCss) {
      this.pickAndWakeLetterAtPointer();
    }
    this.updateBoundTetherStrength();
    this.tryFatFingerMouseGrab();
    this.applyPointerRepulsionBeforeStep();
    this.boundAngularDampBeforeStep();
    this.clearDynamicFloorContact();
    const draggedPre = this.mouseConstraint.body;
    for (const r of this.letterRecords) {
      if (r.latticeGlide) this.applyLatticeGlideBeforePhysics(r, draggedPre, dt);
    }
    Engine.update(this.engine, dt);
    this.updateAnchorMotionAfterStep(dt);
    this.stepReturningHoming(dt);
    this.enforceLetterBounds(getPhysicsViewport(this.app));
    this.recoverBrokenBodies();
    this.healLockedLettersToAnchors(dt);

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
    this.recordsPickSorted = [];
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
    this.recordsPickSorted = [];
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
      if (r.anchorPhase === 'locked' && r.body.isStatic) {
        Body.setPosition(r.body, { x: p.x, y: p.y });
      }
    }
  }

  private spawnLetterGrid(css: { cw: number; ch: number }) {
    const layout = layoutSourcehiveInViewport(css.cw, css.ch, LAYOUT_FRAC_Y);
    this.fillAnchorCacheFromLayout(layout);
    let order = 0;
    for (const t of layout.tiles) {
      const body = Bodies.rectangle(t.x, t.y, this.cellSizeCss, this.cellSizeCss, {
        isStatic: true,
        friction: 0.5,
        frictionAir: 0.014,
        restitution: 0.32,
        density: LETTER_BODY_DENSITY,
        label: LETTER_LABEL,
        collisionFilter: letterFilterFull(),
      });
      Composite.add(this.engine.world, body);

      const g = new Graphics();
      this.root.addChild(g);
      this.letterRecords.push({
        body,
        g,
        order,
        gx: t.gx,
        gy: t.gy,
        anchorX: t.x,
        anchorY: t.y,
        anchorPhase: 'locked',
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
        boundStuckMs: 0,
        boundLowMotionMs: 0,
        quietOffHomeMs: 0,
        offAnchorRespawnMs: 0,
        boundStuckLastDist: -1,
        latticeGlide: false,
      });
      order += 1;
    }
    this.rebuildRecordsPickOrder();
    this.layoutFrozen = true;
  }
}

function syncMouseDpi(mouse: Mouse, canvas: HTMLCanvasElement) {
  const cw = canvas.clientWidth || canvas.width || 1;
  mouse.pixelRatio = canvas.width / cw;
}
