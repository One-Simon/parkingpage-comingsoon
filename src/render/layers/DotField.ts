import { Container, Graphics } from 'pixi.js';
import type { PointerSample } from '../pointerBridge.ts';

export const DOT_COUNT = 5200;
export const DOT_RADIUS = 1.2;
export const EDGE_MARGIN = 10;

export interface DotFieldTuning {
  repulseRadius: number;
  repulseStrength: number;
  returnSpring: number;
  velocityDamping: number;
  maxSpeed: number;
  trailLength: number;
  trailFalloff: number;
}

export const DEFAULT_DOT_TUNING: DotFieldTuning = Object.freeze({
  repulseRadius: 140,
  repulseStrength: 9500,
  returnSpring: 42,
  velocityDamping: 0.985,
  maxSpeed: 520,
  trailLength: 12,
  trailFalloff: 0.72,
});

type Dot = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ax: number;
  ay: number;
  accent: boolean;
  massApprox: number;
};

export class DotField {
  readonly container: Container;
  readonly tuning: DotFieldTuning;

  private readonly dots: Dot[];
  private readonly gfxBase: Graphics;
  private readonly gfxAccent: Graphics;
  private trailXs: number[] = [];
  private trailYs: number[] = [];
  private lastPixiW: number;
  private lastPixiH: number;

  constructor(pixiW: number, pixiH: number, tuning: DotFieldTuning = DEFAULT_DOT_TUNING) {
    this.tuning = tuning;
    this.lastPixiW = pixiW;
    this.lastPixiH = pixiH;
    this.container = new Container();
    this.gfxBase = new Graphics();
    this.gfxAccent = new Graphics();
    this.container.addChild(this.gfxBase);
    this.container.addChild(this.gfxAccent);

    this.dots = placeDotsOnGrid(pixiW, pixiH, DOT_COUNT);
    this.redraw();
  }

  private pushTrail(px: number, py: number): void {
    const cap = Math.max(1, Math.floor(this.tuning.trailLength));
    this.trailXs.push(px);
    this.trailYs.push(py);
    while (this.trailXs.length > cap) {
      this.trailXs.shift();
      this.trailYs.shift();
    }
  }

  tick(dtSeconds: number, latestPointer: PointerSample, pixiW: number, pixiH: number): void {
    if (dtSeconds <= 0) return;
    const dt = Math.min(dtSeconds, 1 / 30);
    const t = this.tuning;
    const minX = EDGE_MARGIN + DOT_RADIUS;
    const maxX = pixiW - EDGE_MARGIN - DOT_RADIUS;
    const minY = EDGE_MARGIN + DOT_RADIUS;
    const maxY = pixiH - EDGE_MARGIN - DOT_RADIUS;
    const r = t.repulseRadius;
    const r2 = r * r;

    let pointerSamples: Array<{ px: number; py: number; w: number }> | null = null;
    if (latestPointer.x >= 0 && latestPointer.y >= 0) {
      this.pushTrail(latestPointer.x, latestPointer.y);
      const n = this.trailXs.length;
      pointerSamples = [];
      const fall = t.trailFalloff;
      for (let i = 0; i < n; i++) {
        const age = n - 1 - i;
        const w = age === 0 ? 1 : Math.pow(fall, age);
        pointerSamples.push({ px: this.trailXs[i]!, py: this.trailYs[i]!, w });
      }
    } else {
      this.trailXs.length = 0;
      this.trailYs.length = 0;
    }

    for (const d of this.dots) {
      let fx = t.returnSpring * (d.ax - d.x);
      let fy = t.returnSpring * (d.ay - d.y);

      if (pointerSamples) {
        for (const s of pointerSamples) {
          const dx = d.x - s.px;
          const dy = d.y - s.py;
          const dist2 = dx * dx + dy * dy;
          if (dist2 > r2) continue;
          const dist = Math.sqrt(dist2) + 1e-4;
          const gated = 1 - dist / r;
          const base = (t.repulseStrength * s.w * gated * gated) / Math.max(d.massApprox, 0.25);
          fx += (dx / dist) * base;
          fy += (dy / dist) * base;
        }
      }

      d.vx += fx * dt;
      d.vy += fy * dt;
      d.vx *= t.velocityDamping;
      d.vy *= t.velocityDamping;

      const spd = Math.hypot(d.vx, d.vy);
      if (spd > t.maxSpeed) {
        const s = t.maxSpeed / spd;
        d.vx *= s;
        d.vy *= s;
      }

      d.x += d.vx * dt;
      d.y += d.vy * dt;

      if (d.x < minX) {
        d.x = minX;
        d.vx *= -0.35;
      } else if (d.x > maxX) {
        d.x = maxX;
        d.vx *= -0.35;
      }
      if (d.y < minY) {
        d.y = minY;
        d.vy *= -0.35;
      } else if (d.y > maxY) {
        d.y = maxY;
        d.vy *= -0.35;
      }
    }

    this.redraw();
    this.lastPixiW = pixiW;
    this.lastPixiH = pixiH;
  }

  private redraw(): void {
    const colorOff = 0x6e7aaf;
    const colorOn = 0x9eb2ff;
    this.gfxBase.clear();
    for (const d of this.dots) {
      if (!d.accent) {
        this.gfxBase.circle(d.x, d.y, DOT_RADIUS);
      }
    }
    this.gfxBase.fill({ color: colorOff, alpha: 0.55 });

    this.gfxAccent.clear();
    for (const d of this.dots) {
      if (d.accent) {
        this.gfxAccent.circle(d.x, d.y, DOT_RADIUS);
      }
    }
    this.gfxAccent.fill({ color: colorOn, alpha: 0.55 });
  }

  resize(pixiW: number, pixiH: number): void {
    const ow = Math.max(this.lastPixiW, 1);
    const oh = Math.max(this.lastPixiH, 1);
    const sx = pixiW / ow;
    const sy = pixiH / oh;
    for (const d of this.dots) {
      d.x = clamp(d.x * sx, EDGE_MARGIN + DOT_RADIUS, pixiW - EDGE_MARGIN - DOT_RADIUS);
      d.y = clamp(d.y * sy, EDGE_MARGIN + DOT_RADIUS, pixiH - EDGE_MARGIN - DOT_RADIUS);
      d.vx *= sx;
      d.vy *= sy;
      d.ax = clamp(d.ax * sx, EDGE_MARGIN + DOT_RADIUS, pixiW - EDGE_MARGIN - DOT_RADIUS);
      d.ay = clamp(d.ay * sy, EDGE_MARGIN + DOT_RADIUS, pixiH - EDGE_MARGIN - DOT_RADIUS);
    }
    this.trailXs = this.trailXs.map((v) => v * sx);
    this.trailYs = this.trailYs.map((v) => v * sy);
    this.lastPixiW = pixiW;
    this.lastPixiH = pixiH;
    this.redraw();
  }

  dispose(): void {
    this.gfxBase.destroy();
    this.gfxAccent.destroy();
    this.container.destroy({ children: true });
  }
}

function placeDotsOnGrid(pixiW: number, pixiH: number, count: number): Dot[] {
  const dots: Dot[] = [];
  const cols = Math.ceil(Math.sqrt(count * (pixiW / Math.max(pixiH, 1))));
  const rows = Math.ceil(count / cols);
  const stepX = pixiW / cols;
  const stepY = pixiH / rows;
  let i = 0;
  for (let ry = 0; ry < rows && i < count; ry++) {
    for (let cx = 0; cx < cols && i < count; cx++) {
      const jitterX = seededJitter(i, 17) * stepX * 0.42;
      const jitterY = seededJitter(i, 91) * stepY * 0.42;
      const baseX = cx * stepX + stepX / 2;
      const baseY = ry * stepY + stepY / 2;
      const x = clamp(baseX + jitterX, EDGE_MARGIN + DOT_RADIUS, pixiW - EDGE_MARGIN - DOT_RADIUS);
      const y = clamp(baseY + jitterY, EDGE_MARGIN + DOT_RADIUS, pixiH - EDGE_MARGIN - DOT_RADIUS);
      dots.push({
        x,
        y,
        vx: 0,
        vy: 0,
        ax: x,
        ay: y,
        accent: i % 3 === 0,
        massApprox: 0.65 + (seededJitter(i, 3) + 0.5) * 0.7,
      });
      i++;
    }
  }
  return dots;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function seededJitter(i: number, salt: number) {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453123;
  return x - Math.floor(x) - 0.5;
}
