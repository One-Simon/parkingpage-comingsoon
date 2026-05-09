import { Container, Graphics } from 'pixi.js';
import type { PointerSample } from '../pointerBridge.ts';

export const DOT_COUNT = 520;
export const DOT_RADIUS = 1.35;
export const REPULSE_RADIUS = 230;
/** Push strength (tuned with mass implicit = 1) */
export const REPULSE_GAIN = 2600;
export const LINEAR_DRAG = 0.988;
export const MAX_SPEED_PX_PER_S = 440;
/** Soft margin inside canvas where dots bounce */
export const EDGE_MARGIN = 10;

export class DotField {
  readonly container: Container;

  private readonly dots: Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    g: Graphics;
  }>;

  constructor(pixiW: number, pixiH: number) {
    this.container = new Container();

    const dots: DotField['dots'] = [];

    const cols = Math.ceil(Math.sqrt(DOT_COUNT * (pixiW / Math.max(pixiH, 1))));
    const rows = Math.ceil(DOT_COUNT / cols);
    const stepX = pixiW / cols;
    const stepY = pixiH / rows;
    const colorOff = 0x6e7aaf;
    const colorOn = 0x9eb2ff;

    let i = 0;
    for (let ry = 0; ry < rows && i < DOT_COUNT; ry++) {
      for (let cx = 0; cx < cols && i < DOT_COUNT; cx++) {
        const jitterX = seededJitter(i, 17) * stepX * 0.42;
        const jitterY = seededJitter(i, 91) * stepY * 0.42;
        const baseX = cx * stepX + stepX / 2;
        const baseY = ry * stepY + stepY / 2;
        const g = new Graphics();
        drawDot(g, i % 3 === 0 ? colorOn : colorOff);

        dots.push({
          x: clamp(baseX + jitterX, EDGE_MARGIN + DOT_RADIUS, pixiW - EDGE_MARGIN - DOT_RADIUS),
          y: clamp(baseY + jitterY, EDGE_MARGIN + DOT_RADIUS, pixiH - EDGE_MARGIN - DOT_RADIUS),
          vx: 0,
          vy: 0,
          g,
        });
        i++;
      }
    }

    for (const d of dots) {
      d.g.position.set(d.x, d.y);
      this.container.addChild(d.g);
    }

    this.dots = dots;
  }

  tick(dtSeconds: number, latestPointer: PointerSample, pixiW: number, pixiH: number): void {
    if (dtSeconds <= 0) return;
    const dt = Math.min(dtSeconds, 1 / 30);

    let px = latestPointer.x;
    let py = latestPointer.y;

    const repulseRs = REPULSE_RADIUS * REPULSE_RADIUS;

    for (const d of this.dots) {
      let fx = 0;
      let fy = 0;

      if (px >= 0 && py >= 0) {
        const dx = d.x - px;
        const dy = d.y - py;
        const dist2 = dx * dx + dy * dy + 400;
        if (dist2 < repulseRs * 200) {
          const dist = Math.sqrt(dist2);
          const normalized = REPULSE_RADIUS - dist / 20;
          const falloff = Math.max(0, normalized / REPULSE_RADIUS);
          const factor = REPULSE_GAIN * falloff * falloff;
          fx += ((dx || 0.0001) / dist) * factor;
          fy += ((dy || 0.0001) / dist) * factor;
        }
      }

      d.vx += fx * dt;
      d.vy += fy * dt;
      d.vx *= LINEAR_DRAG;
      d.vy *= LINEAR_DRAG;

      const spd = Math.hypot(d.vx, d.vy);
      if (spd > MAX_SPEED_PX_PER_S) {
        const s = MAX_SPEED_PX_PER_S / spd;
        d.vx *= s;
        d.vy *= s;
      }

      d.x += d.vx * dt;
      d.y += d.vy * dt;

      const minX = EDGE_MARGIN + DOT_RADIUS;
      const maxX = pixiW - EDGE_MARGIN - DOT_RADIUS;
      const minY = EDGE_MARGIN + DOT_RADIUS;
      const maxY = pixiH - EDGE_MARGIN - DOT_RADIUS;

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

      d.g.position.set(d.x, d.y);
    }
  }

  resize(pixiW: number, pixiH: number): void {
    for (const d of this.dots) {
      d.x = clamp(d.x, EDGE_MARGIN + DOT_RADIUS, pixiW - EDGE_MARGIN - DOT_RADIUS);
      d.y = clamp(d.y, EDGE_MARGIN + DOT_RADIUS, pixiH - EDGE_MARGIN - DOT_RADIUS);
      d.g.position.set(d.x, d.y);
    }
  }

  dispose(): void {
    for (const d of this.dots) {
      d.g.destroy();
    }
    this.container.destroy({ children: true });
  }
}

function drawDot(g: Graphics, color: number) {
  g.clear();
  g.circle(0, 0, DOT_RADIUS);
  g.fill({ color, alpha: 0.55 });
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

/** Deterministic jitter in roughly [-0.5, 0.5] */
function seededJitter(i: number, salt: number) {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453123;
  return x - Math.floor(x) - 0.5;
}
