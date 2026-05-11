import { Container, Graphics } from 'pixi.js';
import type { PointerSample } from '../pointerBridge.ts';

const DOT_COUNT = 5200;
const DOT_RADIUS = 1.2;
const EDGE_MARGIN = 10;

interface DotFieldTuning {
  repulseRadius: number;
  repulseStrength: number;
  returnSpring: number;
  velocityDamping: number;
  maxSpeed: number;
  trailLength: number;
  trailFalloff: number;
}

const DEFAULT_DOT_TUNING: DotFieldTuning = Object.freeze({
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
  /**
   * Pointer trail held in three preallocated number rings sized by `trailLength`. The head index
   * advances modulo capacity; old samples are overwritten in place. Replaces the old per-frame
   * `Array.push` + `Array.shift` (which was O(n) and produced one allocation per pointer move).
   */
  private trailX: Float64Array;
  private trailY: Float64Array;
  private trailW: Float64Array;
  private trailHead = 0;
  /** Number of valid samples in the ring (≤ capacity); resets to 0 when the pointer leaves. */
  private trailLen = 0;
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

    const cap = Math.max(1, Math.floor(tuning.trailLength));
    this.trailX = new Float64Array(cap);
    this.trailY = new Float64Array(cap);
    this.trailW = new Float64Array(cap);

    this.dots = placeDotsOnGrid(pixiW, pixiH, DOT_COUNT);
    this.redraw();
  }

  private trailCapacity(): number {
    return this.trailX.length;
  }

  private pushTrail(px: number, py: number): void {
    const cap = this.trailCapacity();
    this.trailX[this.trailHead] = px;
    this.trailY[this.trailHead] = py;
    this.trailHead = (this.trailHead + 1) % cap;
    if (this.trailLen < cap) this.trailLen++;
  }

  tick(dtSeconds: number, latestPointer: PointerSample, pixiW: number, pixiH: number): void {
    if (dtSeconds <= 0) return;
    // dt is already clamped by the caller (`bootstrapSimulation` enforces a single 32ms cap).
    const dt = dtSeconds;
    const t = this.tuning;
    const minX = EDGE_MARGIN + DOT_RADIUS;
    const maxX = pixiW - EDGE_MARGIN - DOT_RADIUS;
    const minY = EDGE_MARGIN + DOT_RADIUS;
    const maxY = pixiH - EDGE_MARGIN - DOT_RADIUS;
    const r = t.repulseRadius;
    const r2 = r * r;

    let trailN = 0;
    let oldestIdx = 0;
    let cap = this.trailCapacity();
    if (latestPointer.x >= 0 && latestPointer.y >= 0) {
      this.pushTrail(latestPointer.x, latestPointer.y);
      cap = this.trailCapacity();
      trailN = this.trailLen;
      oldestIdx = (this.trailHead - trailN + cap) % cap;
      // Precompute decay weights into the same ring (writes only to indices we won't read in
      // the dot loop because the dot loop reads via oldestIdx + i mod cap; weights are read at
      // those exact indices). To keep it simple we use a small parallel weight ring.
      const fall = t.trailFalloff;
      for (let i = 0; i < trailN; i++) {
        const ringIdx = (oldestIdx + i) % cap;
        const age = trailN - 1 - i;
        this.trailW[ringIdx] = age === 0 ? 1 : Math.pow(fall, age);
      }
    } else {
      this.trailLen = 0;
      this.trailHead = 0;
    }

    for (const d of this.dots) {
      let fx = t.returnSpring * (d.ax - d.x);
      let fy = t.returnSpring * (d.ay - d.y);

      if (trailN > 0) {
        for (let i = 0; i < trailN; i++) {
          const ringIdx = (oldestIdx + i) % cap;
          const dx = d.x - this.trailX[ringIdx]!;
          const dy = d.y - this.trailY[ringIdx]!;
          const dist2 = dx * dx + dy * dy;
          if (dist2 > r2) continue;
          const dist = Math.sqrt(dist2) + 1e-4;
          const gated = 1 - dist / r;
          const base =
            (t.repulseStrength * this.trailW[ringIdx]! * gated * gated) /
            Math.max(d.massApprox, 0.25);
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
    const cap = this.trailCapacity();
    for (let i = 0; i < cap; i++) {
      this.trailX[i] = (this.trailX[i] ?? 0) * sx;
      this.trailY[i] = (this.trailY[i] ?? 0) * sy;
    }
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
