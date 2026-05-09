import { Bodies, Body, Composite, Engine, Mouse, MouseConstraint } from 'matter-js';
import { Container, Graphics } from 'pixi.js';
import type { Application } from 'pixi.js';
import { cssPixelsToPixiFactors } from '../coords.ts';

const WALL_THICK = 28;

type BoxGfx = Readonly<{ body: Body; g: Graphics; wCss: number; hCss: number }>;

/** Matter world operates in CSS pixel space aligned with Pixi backing buffer scaling. */
export class BoxesLayer {
  readonly root = new Container();
  readonly engine: Engine;

  private mouse!: Mouse;
  private mouseConstraint!: MouseConstraint;

  /** Non-static boxed bodies tracked for syncing */
  private boxRecords: BoxGfx[] = [];
  private walls: Body[] = [];

  private resizeHandler!: () => void;

  /** Reference to Pixi application for coordinate translation. */
  private readonly app: Application;

  constructor(app: Application) {
    this.app = app;
    this.engine = Engine.create({
      gravity: { x: 0, y: 1 },
      enableSleeping: true,
    });
    this.engine.positionIterations = 6;
    this.engine.velocityIterations = 6;

    this.mouse = Mouse.create(this.app.canvas);
    this.mouseConstraint = MouseConstraint.create(this.engine, {
      mouse: this.mouse,
      constraint: { stiffness: 0.32, damping: 0.1 },
    });

    Composite.add(this.engine.world, this.mouseConstraint);
    syncMouseDpi(this.mouse, this.app.canvas);

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

  /** Advance physics (`deltaMs`) and sync sprites. */
  update(deltaMs: number) {
    Engine.update(this.engine, deltaMs);
    const { sx, sy } = cssPixelsToPixiFactors(this.app);
    for (const r of this.boxRecords) {
      const { body: b, g, wCss, hCss } = r;
      g.rotation = b.angle;
      g.position.set(b.position.x * sx, b.position.y * sy);
      g.clear();
      g.rect(-wCss * 0.5 * sx, -hCss * 0.5 * sy, wCss * sx, hCss * sy);
      const fillAlpha = b.isSleeping ? 0.78 : 0.92;
      g.fill({ color: 0x4c5d9f, alpha: fillAlpha });
      g.stroke({ width: Math.max(1, sx), color: 0x1a2033, alpha: 0.7 });
    }
  }

  dispose() {
    window.removeEventListener('resize', this.resizeHandler);
    window.removeEventListener('orientationchange', this.resizeHandler);
    Composite.remove(this.engine.world, this.mouseConstraint);
    Composite.clear(this.engine.world, false);
    Engine.clear(this.engine);
    this.boxRecords.forEach((r) => r.g.destroy());
    this.boxRecords = [];
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

    if (this.boxRecords.length === 0) {
      this.spawnStarterBoxes(css);
    } else {
      this.constrainBodiesTo(css);
    }
  }

  private spawnStarterBoxes(css: { cw: number; ch: number }) {
    const rng = seeded(42);
    const count = 12;
    const baseY = Math.max(css.ch - WALL_THICK * 6, css.ch * 0.62);

    for (let i = 0; i < count; i++) {
      const w = 54 + rng() * 40;
      const h = 48 + rng() * 36;
      const x = rng() * css.cw * 0.76 + css.cw * 0.1;
      const y = baseY - i * (h * 1.06);
      const body = Bodies.rectangle(x, y, w, h, {
        friction: 0.65 + rng() * 0.08,
        restitution: 0.09 + rng() * 0.06,
        density: 0.002 + rng() * 0.002,
      });
      Composite.add(this.engine.world, body);

      const g = new Graphics();
      this.root.addChild(g);
      this.boxRecords.push({ body, g, wCss: w, hCss: h });
    }
  }

  /** Clamp bodies if resized smaller */
  private constrainBodiesTo(css: { cw: number; ch: number }) {
    for (const r of this.boxRecords) {
      Body.setVelocity(r.body, { x: r.body.velocity.x * 0.5, y: r.body.velocity.y * 0.5 });
      if (r.body.position.x > css.cw) {
        Body.setPosition(r.body, {
          x: css.cw - r.wCss * 0.5 - WALL_THICK,
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

function seeded(seed: number) {
  let state = seed;
  return (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 10000) / 10000;
  };
}
