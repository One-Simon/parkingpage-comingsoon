import {
  Bodies,
  Body,
  Composite,
  Constraint,
  Engine,
  Events,
  Mouse,
  MouseConstraint,
  Sleeping,
  Vertices,
} from 'matter-js';
import type { IEvent, IEventCollision, MouseConstraint as Manipulator } from 'matter-js';
import { Container, Graphics } from 'pixi.js';
import type { Application } from 'pixi.js';
import { invalidateCachedCanvasRect } from '../canvasRect.ts';
import { cssPixelsToPixiFactors } from '../coords.ts';
import { drawTiles } from '../mosaic/MosaicRenderer.ts';
import { clientToCanvasCss, getPhysicsViewport } from '../physicsViewport.ts';
import { SourcehiveProvider } from '../mosaic/providers/SourcehiveProvider.ts';
import { transitionPhase } from '../mosaic/PhaseMachine.ts';
import type { TileLayout, TileLayoutProvider, TileRecord } from '../mosaic/types.ts';
import { TILE_LABEL } from '../mosaic/types.ts';
import {
  ENGINE_DELTA_CAP_MS,
  FLOOR_LABEL,
  GRAVITY,
  TILE_BODY_DENSITY as MOSAIC_TILE_DENSITY,
  TILE_CATEGORY as MOSAIC_TILE_CATEGORY,
  WALL_CATEGORY as MOSAIC_WALL_CATEGORY,
  WALL_LABEL,
  WALL_THICK,
  createTileBody,
  tileFilterFull,
  tileFilterWallsOnly,
} from '../mosaic/MosaicPhysics.ts';
import {
  CursorSpeedSampler,
  POINTER_REPULSE_RADIUS_CSS,
  applyPointerField,
} from '../mosaic/PointerField.ts';
import {
  LATTICE_GLIDE_ABORT_MULT,
  LATTICE_GLIDE_ENTER_MULT,
  LATTICE_GLIDE_MAX_MS,
  LATTICE_GLIDE_RETURNING_HANDOFF_MULT,
  LATTICE_GLIDE_SNAP_MULT,
  chooseGlideDurationMs,
  evaluateGlide,
  resetGlideState,
} from '../mosaic/LatticeGlide.ts';
import {
  BOUND_ANGLE_DAMP,
  BOUND_LOCK_ANG_MAX,
  BOUND_LOCK_DIST_MULT,
  BOUND_LOCK_SPEED_MAX,
  BOUND_LOCK_STILL_MS,
  BOUND_STUCK_ANG_MAX,
  BOUND_STUCK_DIST_EPS,
  BOUND_STUCK_LOW_MOTION_ANG,
  BOUND_STUCK_LOW_MOTION_MS,
  BOUND_STUCK_LOW_MOTION_SPD,
  BOUND_STUCK_MS,
  BOUND_STUCK_PROGRESS_MIN,
  BOUND_STUCK_SPD_MAX,
  BOUNDS_PAD_CSS,
  HIT_RELEASE_SPEED,
  HOMING_LAMBDA,
  HOMING_NEAR_STEP_SCALE,
  HOMING_SLOW_OUTER_FRAC,
  HOMING_TETHER_HANDOFF_CELL_MULT,
  HOMING_TETHER_HANDOFF_RELEASE_FRAC,
  OFF_ANCHOR_RESPAWN_MS,
  POST_INTERACT_HOME_RESUME_MS,
  QUIET_OFF_HOME_ANG,
  QUIET_OFF_HOME_MAX_DIST_MULT,
  QUIET_OFF_HOME_MS,
  QUIET_OFF_HOME_SPD,
  RELEASE_COAST_MS,
  RELEASE_DIST_MULT,
  REST_SPEED_MAX,
  RETURN_DELAY_MS,
  SUPPORT_DY_MIN,
  TETHER_DAMPING_FAR,
  TETHER_DAMPING_NEAR,
  TETHER_DAMPING_RELAX,
  TETHER_RAMP_DIST_MULT,
  TETHER_RELAX_RADIUS_MULT,
  TETHER_STIFFNESS_FAR,
  TETHER_STIFFNESS_NEAR,
  TETHER_STIFFNESS_RELAX,
} from '../mosaic/MosaicSettling.ts';

const LETTER_CATEGORY = MOSAIC_TILE_CATEGORY;
const WALL_CATEGORY = MOSAIC_WALL_CATEGORY;
const LETTER_BODY_DENSITY = MOSAIC_TILE_DENSITY;
const MATTER_INERTIA_SCALE = 4;

/** Tight cursor follow; raise toward 1 if drag still lags. */
const MOUSE_CONSTRAINT_STIFFNESS = 0.999;
const MOUSE_CONSTRAINT_DAMPING = 0.06;

/** Snap when nearly home; smaller = stricter "in place". */
const REASSEMBLY_DIST_EPS_MULT = 0.04;

/** If this long at (near) rest but still off anchor, start homing (no instant snap). */
const REASSEMBLY_STILL_MS = 720;
/** Near-anchor `bound` tiles: must be almost motionless to accumulate still time. */
const REASSEMBLY_SPEED_MAX_BOUND = 0.16;
const REASSEMBLY_ANG_MAX = 0.045;

/** Falling, never hits floor: low-speed dwell ⇒ same homing path as floor return. */
const FALLING_AIR_STUCK_MS = 680;
const FALLING_AIR_STUCK_SPEED = 0.2;

/** Glide tunables live in `mosaic/LatticeGlide.ts`. Pointer-field tunables live in
 *  `mosaic/PointerField.ts`. Settling tunables live in `mosaic/MosaicSettling.ts`. */

type DragPayload = IEvent<Manipulator> & { body: Body | null };

type MouseWithButton = Mouse & {
  button: number;
  absolute: { x: number; y: number };
  scale: { x: number; y: number };
  offset: { x: number; y: number };
};

const letterFilterFull = tileFilterFull;
const letterFilterWallsOnly = tileFilterWallsOnly;

/**
 * Mosaic orchestrator. Owns the Matter `Engine`, the Pixi root container, the Matter mouse +
 * `MouseConstraint`, the canvas pointer wiring, and the per-frame `update(dt)` pipeline. Pure
 * sub-systems live as siblings under `src/render/mosaic/`:
 *
 * - {@link MosaicPhysics} — body factory, walls, collision filters, tether primitives.
 * - {@link PointerField} — radial repulsion math + cursor speed sampler.
 * - {@link LatticeGlide} — Hermite curve glide segment math + thresholds.
 * - {@link MosaicSettling} — settling, heal & respawn tunables and pure helpers.
 * - {@link MosaicRenderer} — per-frame Pixi draw of every tile.
 * - {@link PhaseMachine} — typed `bound`/`falling`/`returning` transitions.
 * - {@link TileLayoutProvider} (e.g. {@link SourcehiveProvider}) — pluggable shape source.
 *
 * `update(dt)` orchestrates the order: mouse + grab filters → tether strengths → pointer field →
 * glide pre-step → `Engine.update` → settling/heal → glide finalize → renderer.
 */
export class BoxesLayer {
  readonly root = new Container();
  readonly engine: Engine;

  private mouse!: Mouse;
  private mouseConstraint!: MouseConstraint;

  private tileRecords: TileRecord[] = [];
  /** O(1) `Body → TileRecord` lookup populated on spawn/respawn; replaces `find()` scans. */
  private readonly bodyToTile = new WeakMap<Body, TileRecord>();
  /** Memo for `syncViewportAnchorCache` so we only rebuild on actual viewport size changes. */
  private anchorCacheViewport: { cw: number; ch: number } | null = null;
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
  /** Pluggable layout source. Default = SOURCEHIVE word; injectable in the future. */
  private readonly layoutProvider: TileLayoutProvider = new SourcehiveProvider();
  /** `tile.id` → seed; rebuilt once per {@link BoxesLayer.update}. */
  private anchorLayoutCache = new Map<string, import('../mosaic/types.ts').TileSeed>();

  private primaryPointerDownOnCanvas = false;
  /**
   * True when the pointerdown literally hit a tile hull (`Vertices.contains`). Only then is Matter's
   * `MouseConstraint` allowed to attach and grab the body; otherwise the press is field-only.
   */
  private pointerDownStartedOnLetter = false;
  /** Set when canvas uses Pointer Capture so move/up follow the finger reliably. */
  private pointerCaptureId: number | null = null;

  /**
   * Previous pointer position for **speed-scaled** radial field strength ({@link applyPointerFieldBeforeStep}).
   * Reset on pointer up / new press.
   */
  private readonly cursorSpeed = new CursorSpeedSampler();

  private readonly onWindowPointerEnd: () => void;
  private readonly onWindowPointerMoveWhileDown: (ev: PointerEvent) => void;

  private lastValidViewport: { cw: number; ch: number } | null = null;
  /** Retries when the first relayout sees sub-minimum css size (layout race on fast prod loads). */
  private relayoutDimRetryCount = 0;

  /**
   * Mosaic cell currently grabbed by `MouseConstraint`, if any. Prefer over `mouseConstraint.body` alone:
   * Matter sometimes exposes the attachment only on `constraint.bodyB` for a step.
   */
  private mouseGrabLetterBody(): Body | null {
    const mc = this.mouseConstraint;
    const b = mc.body ?? mc.constraint.bodyB;
    return b != null && b.label === TILE_LABEL ? b : null;
  }

  /**
   * True when the mouse constraint is pulling a **mosaic box** body (one `TileRecord` cell), not
   * a �letter� glyph. Letters in the UI are made of many such boxes.
   */
  private isDraggingBox(): boolean {
    return this.mouseGrabLetterBody() != null;
  }

  /**
   * Radius of the radial pointer **force field** (wake + repulsion); scales with {@link cellSizeCss}.
   * Direct grab uses strict-hull `Vertices.contains` only � no separate fat-finger disc.
   */
  private pointerRepulsionRadiusPx(): number {
    return Math.max(POINTER_REPULSE_RADIUS_CSS, this.cellSizeCss * 2.3552);
  }

  /**
   * Homing / anchor-tether scale from {@link TileRecord.lastBoxInteractPerf} (grab + repulsion).
   * The grabbed box stays at 0 while `mouseConstraint` holds it.
   */
  private boxHomingEase(r: TileRecord): number {
    const b = r.body;
    const grab = this.mouseGrabLetterBody();
    if (grab != null && grab === b) return 0;
    if (r.lastBoxInteractPerf < 0) return 1;
    const dt = performance.now() - r.lastBoxInteractPerf;
    return Math.max(0, Math.min(1, dt / POST_INTERACT_HOME_RESUME_MS));
  }

  /**
   * Drive Matter mouse in the same **CSS canvas space** as mosaic bodies ({@link layoutSourcehiveInViewport}
   * / {@link getPhysicsViewport}). Do not apply {@link Mouse.scale}: with Pixi `autoDensity`, Matter�s
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
      this.cursorSpeed.reset();
      (this.mouse as MouseWithButton).button = -1;
      if (this.pointerCaptureId != null) {
        try {
          this.app.canvas.releasePointerCapture(this.pointerCaptureId);
        } catch {
          /* no-op */
        }
        this.pointerCaptureId = null;
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
        for (const r of this.tileRecords) {
          if (r.phase !== 'bound' && r.phase !== 'falling') continue;
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
      if (!b || b.label !== TILE_LABEL) return;
      this.wakeLetter(b);
      const rec = this.bodyToTile.get(b);
      if (rec?.latticeGlide) this.cancelLatticeGlide(rec);
      if (rec?.phase === 'bound') this.removeAnchorTether(rec);
    };

    this.onDragEnd = (ev: IEvent<Manipulator>) => {
      const b = (ev as DragPayload).body;
      if (!b || b.label !== TILE_LABEL) return;
      const rec = this.bodyToTile.get(b);
      if (!rec) return;
      const now = performance.now();
      rec.lastBoxInteractPerf = now;
      if (rec.phase === 'bound' && !rec.body.isStatic) {
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
      this.cursorSpeed.reset();
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

  /**
   * Matter runs {@link MouseConstraint} on `beforeUpdate` and attaches when the pointer lies inside
   * a body's hull. Clearing `bodyB` after {@link Engine.update} cannot undo forces applied during
   * the physics step. For field-only presses (`!pointerDownStartedOnLetter`), set
   * `collisionFilter.mask` to 0 so the constraint's pick test never selects mosaic cells.
   */
  private syncMouseConstraintPickCollisionFilter(): void {
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
    if (b && b.label === TILE_LABEL) {
      this.releaseMouseConstraintIfDraggingBody(b);
    }
  }

  /**
   * Strict click-on-square: pointerdown only "engages" the mosaic for grab if the cursor lies inside
   * an actual tile hull (`Vertices.contains`). No fat-finger disc � anything else is field-only and
   * Matter's `MouseConstraint` is mask-disabled by {@link syncMouseConstraintPickCollisionFilter}.
   */
  private pointerDownEngagedMosaicAtPress(pt: { x: number; y: number }): boolean {
    for (const rec of this.tileRecords) {
      const body = rec.body;
      if (body.label !== TILE_LABEL) continue;
      const start = body.parts.length > 1 ? 1 : 0;
      for (let p = start; p < body.parts.length; p++) {
        const part = body.parts[p];
        if (part && Vertices.contains(part.vertices, pt)) return true;
      }
    }
    return false;
  }

  private fillAnchorCacheFromLayout(layout: TileLayout): void {
    this.cellSizeCss = layout.defaultCellSizeCss;
    const cache = this.anchorLayoutCache;
    cache.clear();
    for (const t of layout.tiles) {
      cache.set(t.id, t);
    }
    // Force `syncViewportAnchorCache` to re-evaluate on the next frame because the cache may
    // have been built for a viewport size that hasn't reached the memo yet.
    this.anchorCacheViewport = null;
  }

  private computeLayout(cw: number, ch: number): TileLayout {
    return this.layoutProvider.compute(cw, ch);
  }

  private syncViewportAnchorCache(): void {
    const { cw, ch } = getPhysicsViewport(this.app);
    const prev = this.anchorCacheViewport;
    if (prev && prev.cw === cw && prev.ch === ch) return;
    this.anchorCacheViewport = { cw, ch };
    this.fillAnchorCacheFromLayout(this.computeLayout(cw, ch));
  }

  private syncRecordAnchorToLayout(r: TileRecord): void {
    const p = this.anchorLayoutCache.get(r.id);
    if (p) {
      r.anchorX = p.x;
      r.anchorY = p.y;
      r.sizeCss = p.sizeCss;
    }
  }

  private removeAnchorTether(r: TileRecord): void {
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
  private ensureAnchorTether(r: TileRecord): void {
    if (r.latticeGlide) return;
    if (r.phase !== 'bound' || r.body.isStatic) return;
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

  private resetGlideProgress(r: TileRecord): void {
    resetGlideState(r);
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
    const dragged = this.mouseGrabLetterBody();

    for (const r of this.tileRecords) {
      if (r.phase !== 'bound' || r.body.isStatic) continue;
      if (r.latticeGlide) continue;
      const b = r.body;
      if (dragged === b) continue;

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
   * Skips the grabbed body, `returning` and `latticeGlide` tiles (those are kinematically driven).
   */
  private applyPointerFieldBeforeStep(dt: number): void {
    if (!this.primaryPointerDownOnCanvas) return;
    if ((this.mouse as MouseWithButton).button !== 0) return;
    const px = this.mouse.position.x;
    const py = this.mouse.position.y;
    const cursorSpeedPxPerMs = this.cursorSpeed.sample(px, py, dt);
    applyPointerField(this.tileRecords, {
      px,
      py,
      radius: this.pointerRepulsionRadiusPx(),
      cursorSpeedPxPerMs,
      draggedBody: this.mouseGrabLetterBody(),
      now: performance.now(),
    });
  }

  private boundAngularDampBeforeStep(): void {
    const dragged = this.mouseGrabLetterBody();
    for (const r of this.tileRecords) {
      const b = r.body;
      if (b.isStatic || r.phase !== 'bound' || dragged === b) continue;
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
    const rec = this.bodyToTile.get(b);
    if (b.isStatic) {
      Body.setStatic(b, false);
    }
    Sleeping.set(b, false);
    if (rec) {
      this.syncRecordAnchorToLayout(rec);
      transitionPhase(rec, 'bound', 'wakeLetter');
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
   * already dynamic and feel pushes directly. Hard hits still transition `bound` ? `falling` for the
   * struck tile so it doesn't get yanked back instantly by its tether.
   */
  private maybeWakeFromCollisionPair(pair: IEventCollision<Engine>['pairs'][number]): void {
    const a = pair.bodyA;
    const b = pair.bodyB;
    if (a.label !== TILE_LABEL || b.label !== TILE_LABEL) return;
    if (a.isStatic || b.isStatic) return;

    const speedA = Math.hypot(a.velocity.x, a.velocity.y);
    const speedB = Math.hypot(b.velocity.x, b.velocity.y);
    const fast = speedA >= HIT_RELEASE_SPEED ? a : speedB >= HIT_RELEASE_SPEED ? b : null;
    if (!fast) return;
    const target = fast === a ? b : a;

    const rec = this.bodyToTile.get(target);
    if (!rec || rec.phase !== 'bound') return;
    transitionPhase(rec, 'falling', 'collisionWake');
    rec.floorDwellMs = 0;
    rec.offAnchorStillMs = 0;
    rec.airStuckMs = 0;
    rec.tetherSettleMs = 0;
    this.removeAnchorTether(rec);
  }

  private applyFloorContactFromPair(pair: IEventCollision<Engine>['pairs'][number]): void {
    const a = pair.bodyA;
    const b = pair.bodyB;
    if (a.label === FLOOR_LABEL && b.label === TILE_LABEL && !b.isStatic) {
      const r = this.bodyToTile.get(b);
      if (r) r.touchingFloor = true;
      return;
    }
    if (b.label === FLOOR_LABEL && a.label === TILE_LABEL && !a.isStatic) {
      const r = this.bodyToTile.get(a);
      if (r) r.touchingFloor = true;
    }
  }

  private applyLetterSupportFromPair(pair: IEventCollision<Engine>['pairs'][number]): void {
    const a = pair.bodyA;
    const b = pair.bodyB;
    if (a.label !== TILE_LABEL || b.label !== TILE_LABEL) return;
    const dyBetween = b.position.y - a.position.y;
    const upper = dyBetween >= 0 ? a : b;
    const lower = upper === a ? b : a;
    if (upper.isStatic) return;
    const dy = lower.position.y - upper.position.y;
    if (dy < SUPPORT_DY_MIN) return;
    if (pair.collision.depth <= pair.slop + 0.02) return;
    const rec = this.bodyToTile.get(upper);
    if (rec) rec.touchingSupport = true;
  }

  private clearDynamicFloorContact(): void {
    for (const r of this.tileRecords) {
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
  private settleLetterAtAnchor(r: TileRecord): void {
    const b = r.body;
    this.syncRecordAnchorToLayout(r);
    if (b.isStatic) Body.setStatic(b, false);
    b.collisionFilter = letterFilterFull();
    Body.setPosition(b, { x: r.anchorX, y: r.anchorY });
    Body.setAngle(b, 0);
    Body.setVelocity(b, { x: 0, y: 0 });
    Body.setAngularVelocity(b, 0);
    Sleeping.set(b, false);
    transitionPhase(r, 'bound', 'settleLetterAtAnchor');
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
  private transitionBoundToFallingFromReleaseBand(rec: TileRecord): void {
    rec.latticeGlide = false;
    this.resetGlideProgress(rec);
    transitionPhase(rec, 'falling', 'dragReleaseFalling');
    rec.floorDwellMs = 0;
    rec.offAnchorStillMs = 0;
    rec.airStuckMs = 0;
    rec.tetherSettleMs = 0;
    this.removeAnchorTether(rec);
  }

  private tryReleaseFromMotion(rec: TileRecord, dragged: Body | null | undefined): void {
    const b = rec.body;
    if (rec.phase !== 'bound' || b.isStatic || dragged === b) return;

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
    r: TileRecord,
    deltaMs: number,
    dragged: Body | null | undefined,
  ): void {
    const b = r.body;
    if (dragged === b) {
      r.offAnchorStillMs = 0;
      return;
    }
    if (this.isDraggingBox() && r.phase === 'bound') {
      r.offAnchorStillMs = 0;
      return;
    }
    if (r.phase === 'returning') {
      r.offAnchorStillMs = 0;
      return;
    }

    if (r.phase === 'falling') {
      // Only the actual canvas FLOOR counts as "rested"; resting on top of another tile must NOT
      // trigger the homing return (otherwise stacked piles get yanked back to the lattice).
      const grounded = r.touchingFloor;
      if (!grounded || b.isStatic) {
        r.offAnchorStillMs = 0;
        return;
      }
    } else if (r.phase === 'bound') {
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
      r.phase === 'falling' ? REST_SPEED_MAX : REASSEMBLY_SPEED_MAX_BOUND;
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
   * distance to the anchor barely changes while speeds are low, snap the tile to its lattice cell �
   * avoids indefinite tether deadlock.
   */
  private maybeForceSnapBoundWhenStuck(
    r: TileRecord,
    deltaMs: number,
    dragged: Body | null | undefined,
  ): void {
    const b = r.body;
    if (r.phase !== 'bound' || b.isStatic || r.latticeGlide || dragged === b) {
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
   * Simple stuck completion: quiet body, not at anchor, already near the mosaic ? lock to lattice cell.
   */
  private maybeSettleBoundWhenQuietOffHome(
    r: TileRecord,
    deltaMs: number,
    dragged: Body | null | undefined,
  ): void {
    const b = r.body;
    if (r.phase !== 'bound' || b.isStatic || r.latticeGlide || dragged === b) {
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

  /** Long, nearly still hover at anchor under tether ? lock grid (slow final commit). */
  private maybeCommitBoundToLocked(
    r: TileRecord,
    deltaMs: number,
    dragged: Body | null | undefined,
  ): void {
    const b = r.body;
    if (r.phase !== 'bound' || b.isStatic || dragged === b) {
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

  private cancelLatticeGlide(r: TileRecord): void {
    if (!r.latticeGlide) return;
    const b = r.body;
    r.latticeGlide = false;
    b.collisionFilter = letterFilterFull();
    Sleeping.set(b, false);
    Body.setStatic(b, false);
    Body.setVelocity(b, { x: 0, y: 0 });
    Body.setAngularVelocity(b, 0);
    if (r.phase === 'bound') this.ensureAnchorTether(r);
    this.resetGlideProgress(r);
  }

  /**
   * Glide is a kinematic position lerp. Leaving letter�letter collisions on means `Body.setPosition`
   * can drive the glider INTO a neighbor, and the next-frame collision solver produces a large
   * separation impulse (that's the "jerk" the user reported). Switch to walls-only for the duration
   * of the glide; full collisions are restored in {@link settleLetterAtAnchor} / {@link cancelLatticeGlide}.
   *
   * Captures the body's current velocity (in CSS px / ms) BEFORE zeroing so the cubic Hermite curve
   * can blend it into the start of the return � preserving momentum across the state change.
   */
  private enterLatticeGlide(r: TileRecord): void {
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

  private maybeBeginLatticeGlide(r: TileRecord, dragged: Body | null | undefined): void {
    const b = r.body;
    if (r.latticeGlide || r.phase !== 'bound' || b.isStatic || dragged === b) return;
    // If the field has touched this tile recently, do NOT re-enter the kinematic glide � it would
    // override applyForce by snapping the tile back to anchor each tick. Tiles on the leading edge of
    // the mosaic sat right on their anchor and got re-glided every frame, hiding the radial push.
    if (this.boxHomingEase(r) < 1) return;
    this.syncRecordAnchorToLayout(r);
    const dist = Math.hypot(r.anchorX - b.position.x, r.anchorY - b.position.y);
    const dEnter = Math.max(2, this.cellSizeCss * LATTICE_GLIDE_ENTER_MULT);
    if (dist > dEnter) return;
    this.enterLatticeGlide(r);
  }

  private finishLatticeGlide(r: TileRecord): void {
    r.latticeGlide = false;
    this.settleLetterAtAnchor(r);
  }

  /** Lerp toward anchor before Matter resolves contacts (reduces jitter vs post-step teleport). */
  private applyLatticeGlideBeforePhysics(
    r: TileRecord,
    dragged: Body | null | undefined,
    deltaMs: number,
  ): void {
    const b = r.body;
    if (dragged === b) {
      this.cancelLatticeGlide(r);
      return;
    }
    if (r.phase !== 'bound') {
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
      // Outward speed (px/ms): positive when velocity points away from the anchor.
      const outwardSpeed = Math.max(0, -(r.latticeGlideStartVx * ux + r.latticeGlideStartVy * uy));
      r.latticeGlideDurationMs = chooseGlideDurationMs(
        startDist,
        outwardSpeed,
        r.latticeGlideIsSpawn
      );
    }

    r.latticeGlideElapsedMs += deltaMs;
    const D = r.latticeGlideDurationMs;
    const t = Math.max(0, Math.min(1, r.latticeGlideElapsedMs / D));
    const out = evaluateGlide(
      t,
      { x: r.latticeGlideStartX, y: r.latticeGlideStartY },
      { x: ax, y: ay },
      { vx: r.latticeGlideStartVx, vy: r.latticeGlideStartVy },
      D
    );
    Body.setPosition(b, { x: out.x, y: out.y });
    Body.setAngle(b, b.angle * (1 - out.easedAngleDecay * 0.95));
    Body.setVelocity(b, { x: 0, y: 0 });
    Body.setAngularVelocity(b, 0);
  }

  /** After physics: snap / stuck-timeout � uses post-collision distance. */
  private finalizeLatticeGlideAfterPhysics(
    r: TileRecord,
    dragged: Body | null | undefined,
    _deltaMs: number,
  ): void {
    if (!r.latticeGlide) return;
    const b = r.body;
    if (dragged === b) {
      this.cancelLatticeGlide(r);
      return;
    }
    if (r.phase !== 'bound') {
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
    // finish the glide either by curve completion (`elapsed >= duration`) or by the absolute
    // MAX_MS safety net.
    const segmentDone =
      r.latticeGlideDurationMs > 0 && r.latticeGlideElapsedMs >= r.latticeGlideDurationMs;
    if (segmentDone || r.latticeGlideElapsedMs >= LATTICE_GLIDE_MAX_MS) {
      this.finishLatticeGlide(r);
      return;
    }
  }

  private beginReturningPhase(r: TileRecord): void {
    const b = r.body;
    transitionPhase(r, 'returning', 'beginReturningPhase');
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
  private transitionReturningToBound(r: TileRecord): void {
    const b = r.body;
    if (r.phase !== 'returning') return;
    this.removeAnchorTether(r);
    this.syncRecordAnchorToLayout(r);
    Body.setAngle(b, 0);
    Body.setVelocity(b, { x: 0, y: 0 });
    Body.setAngularVelocity(b, 0);
    transitionPhase(r, 'bound', 'returningHandoff');
    r.floorDwellMs = 0;
    r.touchingFloor = false;
    r.touchingSupport = false;
    r.offAnchorStillMs = 0;
    r.airStuckMs = 0;
    r.tetherSettleMs = 0;
    this.enterLatticeGlide(r);
  }

  /**
   * `returning` uses `letterFilterWallsOnly` so letters don�t collide with the pile.
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

    for (const r of this.tileRecords) {
      if (r.phase !== 'returning') continue;
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

    for (const r of this.tileRecords) {
      const b = r.body;

      if (r.phase === 'falling') {
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
          /** Letter-on-letter rest sets `touchingSupport`; that is not �air�, so do not snap homing via air-stuck. */
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
      if (r.phase === 'bound' && !r.body.isStatic && dragged !== r.body) {
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
    const minCy = half + pad;
    let maxCx = css.cw - half - pad;
    if (minCx > maxCx) {
      const mid = css.cw * 0.5;
      minCx = mid;
      maxCx = mid;
    }

    for (const r of this.tileRecords) {
      const b = r.body;
      if (b.isStatic || r.phase === 'bound') continue;

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
    for (const r of this.tileRecords) {
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
        transitionPhase(r, 'bound', 'recoverBrokenBodies');
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
  private respawnLetterAtAnchor(r: TileRecord): void {
    this.removeAnchorTether(r);
    const oldBody = r.body;
    this.releaseMouseConstraintIfDraggingBody(oldBody);
    this.bodyToTile.delete(oldBody);

    const gIdx = this.root.getChildIndex(r.g);
    Composite.remove(this.engine.world, oldBody);
    r.g.destroy({ children: true });

    this.syncRecordAnchorToLayout(r);
    const ax = r.anchorX;
    const ay = r.anchorY;

    const body = createTileBody({ x: ax, y: ay }, r.sizeCss, {
      collisionFilter: letterFilterFull(),
    });
    Composite.add(this.engine.world, body);

    const g = new Graphics();
    const insertAt = Math.max(0, Math.min(gIdx, this.root.children.length));
    this.root.addChildAt(g, insertAt);

    r.body = body;
    r.g = g;
    this.bodyToTile.set(body, r);
    transitionPhase(r, 'bound', 'respawnTileAtAnchor');
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
    r: TileRecord,
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
    this.suppressMisalignedLetterMouseGrab();
    this.updateBoundTetherStrength();
    this.applyPointerFieldBeforeStep(dt);
    this.boundAngularDampBeforeStep();
    this.clearDynamicFloorContact();
    const draggedPre = this.mouseGrabLetterBody();
    for (const r of this.tileRecords) {
      if (r.latticeGlide) this.applyLatticeGlideBeforePhysics(r, draggedPre, dt);
    }
    Engine.update(this.engine, dt);
    this.suppressMisalignedLetterMouseGrab();
    this.updateAnchorMotionAfterStep(dt);
    this.stepReturningHoming(dt);
    this.enforceLetterBounds(getPhysicsViewport(this.app));
    this.recoverBrokenBodies();

    drawTiles(this.tileRecords, cssPixelsToPixiFactors(this.app));
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
    for (const r of this.tileRecords) {
      this.removeAnchorTether(r);
    }
    Composite.remove(this.engine.world, this.mouseConstraint);
    Composite.clear(this.engine.world, false);
    Engine.clear(this.engine);
    this.tileRecords.forEach((r) => r.g.destroy());
    this.tileRecords = [];
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
        if (this.relayoutDimRetryCount < 30) {
          this.relayoutDimRetryCount++;
          invalidateCachedCanvasRect(this.app);
          requestAnimationFrame(() => {
            void this.relayout(getPhysicsViewport(this.app));
          });
        }
        return;
      }
    } else {
      this.lastValidViewport = { cw, ch };
      this.relayoutDimRetryCount = 0;
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

    if (this.tileRecords.length === 0) {
      this.spawnLetterGrid(css);
    } else if (!this.layoutFrozen) {
      this.rebuildLetterMosaic(css);
    } else {
      this.refreshAnchorsFromLayout(css);
    }
  }

  private clearLetterBodies() {
    for (const r of this.tileRecords) {
      this.removeAnchorTether(r);
      this.bodyToTile.delete(r.body);
      Composite.remove(this.engine.world, r.body);
      r.g.destroy();
    }
    this.tileRecords = [];
  }

  private rebuildLetterMosaic(css: { cw: number; ch: number }) {
    this.clearLetterBodies();
    this.spawnLetterGrid(css);
  }

  private refreshAnchorsFromLayout(css: { cw: number; ch: number }) {
    this.fillAnchorCacheFromLayout(this.computeLayout(css.cw, css.ch));
    for (const r of this.tileRecords) {
      const p = this.anchorLayoutCache.get(r.id);
      if (!p) continue;
      r.anchorX = p.x;
      r.anchorY = p.y;
      r.sizeCss = p.sizeCss;
      if (r.anchorTether) {
        r.anchorTether.pointA.x = p.x;
        r.anchorTether.pointA.y = p.y;
      }
      // Tether will pull dynamic bodies back to the new anchor automatically.
    }
  }

  private spawnLetterGrid(css: { cw: number; ch: number }) {
    const layout = this.computeLayout(css.cw, css.ch);
    this.fillAnchorCacheFromLayout(layout);
    // Per-tile randomized scatter inside the lattice-glide range, then the SAME
    // `applyLatticeGlideBeforePhysics` that does the final snap lerps each tile onto its anchor.
    // Spawn distance must stay below `LATTICE_GLIDE_ABORT_MULT * tile.sizeCss` (~7×) or the
    // glide aborts before completing.
    for (const t of layout.tiles) {
      const sizeCss = t.sizeCss;
      const scatterMin = sizeCss * 1.5;
      const scatterMax = sizeCss * 5.5;
      const ang = Math.random() * Math.PI * 2;
      const dist = scatterMin + Math.random() * (scatterMax - scatterMin);
      const sx = t.x + Math.cos(ang) * dist;
      const sy = t.y + Math.sin(ang) * dist;
      const body = createTileBody({ x: sx, y: sy }, sizeCss, {
        collisionFilter: letterFilterWallsOnly(),
      });
      Body.setVelocity(body, { x: 0, y: 0 });
      Body.setAngularVelocity(body, 0);
      Composite.add(this.engine.world, body);

      const g = new Graphics();
      this.root.addChild(g);
      const rec: TileRecord = {
        id: t.id,
        sizeCss,
        body,
        g,
        anchorX: t.x,
        anchorY: t.y,
        phase: 'bound',
        floorDwellMs: 0,
        touchingFloor: false,
        touchingSupport: false,
        offAnchorStillMs: 0,
        airStuckMs: 0,
        tetherSettleMs: 0,
        lastBoxInteractPerf: -1,
        anchorTether: null,
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
      this.tileRecords.push(rec);
      this.bodyToTile.set(body, rec);
    }
    this.layoutFrozen = true;
  }
}

/** Physics and layout use CSS pixels; keep mouse pixelRatio neutral so constraints match bodies. */
function syncMouseDpi(mouse: Mouse, _canvas: HTMLCanvasElement) {
  mouse.pixelRatio = 1;
}
