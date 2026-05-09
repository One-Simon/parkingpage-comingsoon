import { Bodies, Body, Composite, Engine, Events, Mouse, MouseConstraint } from 'matter-js';
import type { IEvent, IEventCollision, MouseConstraint as Manipulator } from 'matter-js';
import { Container, Graphics } from 'pixi.js';
import type { Application } from 'pixi.js';
import { layoutSourcehiveInViewport } from '../blockLetters/sourcehiveLayout.ts';
import { cssPixelsToPixiFactors } from '../coords.ts';

const WALL_THICK = 28;
const LETTER_LABEL = 'sourcehive-cell';
const CELL_BASE_CSS = 12;
const CELL_SHRINK = 0.8;
const CELL_SIZE_CSS = CELL_BASE_CSS * CELL_SHRINK;
const LAYOUT_FRAC_Y = 0.38;
const WAKE_SPEED = 1.15;

type LetterRecord = Readonly<{
  body: Body;
  g: Graphics;
  order: number;
}>;

type DragPayload = IEvent<Manipulator> & { body: Body | null };

export class BoxesLayer {
  readonly root = new Container();
  readonly engine: Engine;

  private mouse!: Mouse;
  private mouseConstraint!: MouseConstraint;

  private letterRecords: LetterRecord[] = [];
  private walls: Body[] = [];

  private resizeHandler!: () => void;
  private readonly onCollisionStart: (ev: IEventCollision<Engine>) => void;
  private readonly onDragStart: (ev: IEvent<Manipulator>) => void;

  private readonly app: Application;
  private layoutFrozen = false;

  constructor(app: Application) {
    this.app = app;
    this.engine = Engine.create({
      gravity: { x: 0, y: 1 },
      enableSleeping: true,
    });
    this.engine.positionIterations = 8;
    this.engine.velocityIterations = 8;

    this.mouse = Mouse.create(this.app.canvas);
    this.mouseConstraint = MouseConstraint.create(this.engine, {
      mouse: this.mouse,
      constraint: { stiffness: 0.32, damping: 0.1 },
    });

    Composite.add(this.engine.world, this.mouseConstraint);
    syncMouseDpi(this.mouse, this.app.canvas);

    this.onDragStart = (ev: IEvent<Manipulator>) => {
      const b = (ev as DragPayload).body;
      if (!b || b.label !== LETTER_LABEL) return;
      this.wakeLetter(b);
    };

    this.onCollisionStart = (ev: IEventCollision<Engine>) => {
      for (const pair of ev.pairs) {
        const a = pair.bodyA;
        const b = pair.bodyB;
        this.maybeWakeFromImpact(a, b);
        this.maybeWakeFromImpact(b, a);
      }
    };

    Events.on(this.mouseConstraint, 'startdrag', this.onDragStart);
    Events.on(this.engine, 'collisionStart', this.onCollisionStart);

    this.resizeHandler = () => {
      this.relayout(readCssViewport());
      syncMouseDpi(this.mouse, this.app.canvas);
    };

    window.addEventListener('resize', this.resizeHandler, { passive: true });
    window.addEventListener('orientationchange', this.resizeHandler, { passive: true });

    requestAnimationFrame(() => {
      void this.relayout(readCssViewport());
    });
  }

  private wakeLetter(b: Body): void {
    if (!b.isStatic) return;
    Body.setStatic(b, false);
    Body.setVelocity(b, { x: b.velocity.x, y: b.velocity.y });
    this.layoutFrozen = true;
  }

  private maybeWakeFromImpact(letter: Body, other: Body): void {
    if (letter.label !== LETTER_LABEL || !letter.isStatic) return;
    if (other.label === LETTER_LABEL && other.isStatic) return;
    const speed = Math.hypot(other.velocity.x, other.velocity.y);
    if (speed < WAKE_SPEED) return;
    this.wakeLetter(letter);
  }

  update(deltaMs: number) {
    Engine.update(this.engine, deltaMs);
    const { sx, sy } = cssPixelsToPixiFactors(this.app);
    const side = CELL_SIZE_CSS;
    for (const r of this.letterRecords) {
      const b = r.body;
      const g = r.g;
      g.rotation = b.angle;
      g.position.set(b.position.x * sx, b.position.y * sy);
      g.clear();
      g.rect(-side * 0.5 * sx, -side * 0.5 * sy, side * sx, side * sy);
      const fillAlpha = b.isSleeping ? 0.78 : 0.92;
      g.fill({ color: 0x4c5d9f, alpha: fillAlpha });
      g.stroke({ width: Math.max(1, sx), color: 0x1a2033, alpha: 0.7 });
    }
  }

  dispose() {
    window.removeEventListener('resize', this.resizeHandler);
    window.removeEventListener('orientationchange', this.resizeHandler);
    Events.off(this.mouseConstraint, 'startdrag', this.onDragStart);
    Events.off(this.engine, 'collisionStart', this.onCollisionStart);
    Composite.remove(this.engine.world, this.mouseConstraint);
    Composite.clear(this.engine.world, false);
    Engine.clear(this.engine);
    this.letterRecords.forEach((r) => r.g.destroy());
    this.letterRecords = [];
    this.walls = [];
    this.root.destroy({ children: true });
  }

  viewportCss(): { cw: number; ch: number } {
    return readCssViewport();
  }

  pixiDimensions(): { w: number; h: number } {
    return {
      w: this.app.renderer.width,
      h: this.app.renderer.height,
    };
  }

  private relayout(css: { cw: number; ch: number }) {
    const { cw, ch } = css;

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
        friction: 0.75,
        restitution: 0.06,
      }
    );
    const ceil = Bodies.rectangle(cw / 2, -WALL_THICK * 6, cw + WALL_THICK * 14, WALL_THICK, {
      isStatic: true,
      friction: 0.08,
      restitution: 0.03,
    });
    const left = Bodies.rectangle(-WALL_THICK / 2, ch / 2, WALL_THICK, ch * 3 + 400, {
      isStatic: true,
      friction: 0.2,
      restitution: 0.06,
    });
    const right = Bodies.rectangle(cw + WALL_THICK / 2, ch / 2, WALL_THICK, ch * 3 + 400, {
      isStatic: true,
      friction: 0.2,
      restitution: 0.06,
    });

    this.walls.push(floor, ceil, left, right);
    Composite.add(this.engine.world, this.walls);

    if (this.letterRecords.length === 0) {
      this.spawnLetterGrid(css);
    } else if (!this.layoutFrozen) {
      this.repositionStaticLetters(css);
    } else {
      this.constrainBodiesTo(css);
    }
  }

  private spawnLetterGrid(css: { cw: number; ch: number }) {
    const layout = layoutSourcehiveInViewport(css.cw, css.ch, CELL_SIZE_CSS, LAYOUT_FRAC_Y);
    let order = 0;
    for (const c of layout.centersCss) {
      const body = Bodies.rectangle(c.x, c.y, CELL_SIZE_CSS, CELL_SIZE_CSS, {
        isStatic: true,
        friction: 0.65,
        restitution: 0.1,
        density: 0.003,
        label: LETTER_LABEL,
      });
      Composite.add(this.engine.world, body);

      const g = new Graphics();
      this.root.addChild(g);
      this.letterRecords.push({ body, g, order });
      order += 1;
    }
  }

  private repositionStaticLetters(css: { cw: number; ch: number }) {
    const layout = layoutSourcehiveInViewport(css.cw, css.ch, CELL_SIZE_CSS, LAYOUT_FRAC_Y);
    for (const r of this.letterRecords) {
      if (!r.body.isStatic) continue;
      const target = layout.centersCss[r.order];
      if (!target) continue;
      Body.setPosition(r.body, { x: target.x, y: target.y });
      Body.setAngle(r.body, 0);
      Body.setVelocity(r.body, { x: 0, y: 0 });
      Body.setAngularVelocity(r.body, 0);
    }
  }

  private constrainBodiesTo(css: { cw: number; ch: number }) {
    for (const r of this.letterRecords) {
      Body.setVelocity(r.body, { x: r.body.velocity.x * 0.5, y: r.body.velocity.y * 0.5 });
      if (r.body.position.x > css.cw) {
        Body.setPosition(r.body, {
          x: css.cw - CELL_SIZE_CSS * 0.5 - WALL_THICK,
          y: r.body.position.y,
        });
      }
      if (r.body.position.y > css.ch + 240) {
        Body.setPosition(r.body, {
          x: clamp(r.body.position.x, WALL_THICK, css.cw - WALL_THICK),
          y: css.ch * 0.45,
        });
      }
    }
  }
}

function readCssViewport() {
  if (typeof window === 'undefined') {
    return { cw: 1280, ch: 720 };
  }
  return { cw: window.innerWidth, ch: window.innerHeight };
}

function syncMouseDpi(mouse: Mouse, canvas: HTMLCanvasElement) {
  const cw = canvas.clientWidth || canvas.width || 1;
  mouse.pixelRatio = canvas.width / cw;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}
