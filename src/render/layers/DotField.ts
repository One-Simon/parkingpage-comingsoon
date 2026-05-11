import { Assets, Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { PointerSample } from '../pointerBridge.ts';

const DOT_COUNT = 4500;
/**
 * Target logo density: roughly one glyph per {@link GLYPH_SLOT_PERIOD} lattice cells (~0.5%).
 * Placement uses a seeded shuffle — not modulus on row-major order — so logos scatter instead of stripes.
 */
const GLYPH_SLOT_PERIOD = 200;
/** Fixed RNG seed so logo positions shuffle the same across reloads/resizes until this changes. */
const GLYPH_SHUFFLE_SEED = (0xd6e8dcb5 ^ 0x7c9d3a2f) >>> 0;

/** Near-white raster fill so stars max out luminance at a given alpha (warm ivory would read dimmer). */
const STAR_FIELD_COLOR = 0xfffff8;

/** Initial glyph scale (small favicons blur away on HiDPR without a modest floor). */
const GLYPH_BASE_SCALE = 1.5;

/** Initial glyph size before multiplier (scaled by layout / resize). */
const ICON_BASE_SIZE = 9 * 0.8;
const ICON_SIZE_MUL_MAX = 1.52;
/** Every field logo uses identical pixel size (`max multiplier × base × HiDPR scale`). */
const GLYPH_SIDE = ICON_BASE_SIZE * GLYPH_BASE_SCALE * ICON_SIZE_MUL_MAX;

const EDGE_SLIVER = 2;
const GLYPH_ALPHA = 0.9;

/** Discrete star core radii (limited size set). */
const DISPLAY_STAR_RADII = Object.freeze([0.42, 0.62, 0.88, 1.22]);
const HALO_RADIUS_MULT = 5.35;

/** Layout spacing for anchor grid (worst-case glyph footprint). */
const PLACEMENT_EXTENT_HALF = Math.max(
  GLYPH_SIDE * 0.5,
  DISPLAY_STAR_RADII[DISPLAY_STAR_RADII.length - 1]! * 1.85
);

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

type Phys = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ax: number;
  ay: number;
  massApprox: number;
};

type LayoutSeedsResult = {
  seeds: Phys[];
  glyphSlotIndices: ReadonlySet<number>;
};

type StarDatum = Phys & {
  kind: 'star';
  r: number;
  coreAlpha: number;
  haloAlpha: number;
};

type GlyphDatum = Phys & {
  kind: 'glyph';
  sprite: Sprite;
};

/** Load favicon texture once before constructing {@link DotField}. */
export async function loadDotFieldFaviconTexture(): Promise<Texture> {
  return Assets.load<Texture>('/favicon.png');
}

export class DotField {
  readonly container: Container;
  readonly tuning: DotFieldTuning;

  private readonly stars: StarDatum[];
  private readonly glyphs: GlyphDatum[];
  private readonly gfxHalos: Graphics;
  private readonly gfxStarCores: Graphics;

  private trailX: Float64Array;
  private trailY: Float64Array;
  private trailW: Float64Array;
  private trailHead = 0;
  private trailLen = 0;
  private lastPixiW: number;
  private lastPixiH: number;

  constructor(pixiW: number, pixiH: number, texture: Texture, tuning: DotFieldTuning = DEFAULT_DOT_TUNING) {
    this.tuning = tuning;
    this.lastPixiW = pixiW;
    this.lastPixiH = pixiH;
    this.container = new Container();

    const cap = Math.max(1, Math.floor(tuning.trailLength));
    this.trailX = new Float64Array(cap);
    this.trailY = new Float64Array(cap);
    this.trailW = new Float64Array(cap);

    this.gfxHalos = new Graphics();
    this.gfxStarCores = new Graphics();
    this.gfxHalos.blendMode = 'screen';

    const { seeds, glyphSlotIndices } = sliceLayoutSeeds(pixiW, pixiH, DOT_COUNT);

    const starsOut: StarDatum[] = [];
    const glyphsOut: GlyphDatum[] = [];

    let starSeq = 0;

    for (let slotIdx = 0; slotIdx < seeds.length; slotIdx++) {
      const L = seeds[slotIdx]!;
      if (glyphSlotIndices.has(slotIdx)) {
        const spr = new Sprite({
          texture,
          anchor: 0.5,
        });
        spr.tint = 0xffffff;
        spr.alpha = GLYPH_ALPHA;
        spr.roundPixels = true;
        spr.blendMode = 'normal';
        spr.width = GLYPH_SIDE;
        spr.height = GLYPH_SIDE;
        spr.zIndex = 2;
        spr.position.set(L.x, L.y);
        glyphsOut.push({ ...L, kind: 'glyph', sprite: spr });
        this.container.addChild(spr);
      } else {
        const uBright = seededDeterministicUnit(starSeq, 713);
        const rPick = Math.floor(
          seedPerm03(starSeq + 501) * DISPLAY_STAR_RADII.length
        ) % DISPLAY_STAR_RADII.length;
        const r = DISPLAY_STAR_RADII[rPick]!;
        let coreAlpha = 0.62 + uBright * 0.23;
        let haloAlpha = 0;
        if (uBright > 0.87) {
          coreAlpha = 0.91 + seededDeterministicUnit(starSeq, 3) * 0.07;
          haloAlpha = 0.092 + seededDeterministicUnit(starSeq, 5) * 0.09;
        } else if (uBright < 0.22) {
          coreAlpha = 0.56 + seededDeterministicUnit(starSeq, 7) * 0.1;
        }
        starsOut.push({
          ...L,
          kind: 'star',
          r,
          coreAlpha,
          haloAlpha,
        });
        starSeq++;
      }
    }

    this.stars = starsOut;
    this.glyphs = glyphsOut;

    this.container.sortableChildren = true;
    this.gfxHalos.zIndex = 0;
    this.gfxStarCores.zIndex = 1;

    this.container.addChild(this.gfxHalos);
    this.container.addChild(this.gfxStarCores);

    this.redrawStars();
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

  private redrawStars(): void {
    const c = STAR_FIELD_COLOR;

    /** Quantize halo α so we can batch-fill few Graphics paths. */
    const haloBuckets = new Map<number, StarDatum[]>();
    for (const s of this.stars) {
      if (s.haloAlpha <= 0) continue;
      const k = snap(s.haloAlpha, 100);
      let b = haloBuckets.get(k);
      if (!b) {
        b = [];
        haloBuckets.set(k, b);
      }
      b.push(s);
    }

    const haloKeysAsc = [...haloBuckets.keys()].sort((a, b) => a - b);

    this.gfxHalos.clear();
    for (const k of haloKeysAsc) {
      const group = haloBuckets.get(k)!;
      for (const s of group) {
        this.gfxHalos.circle(s.x, s.y, s.r * HALO_RADIUS_MULT);
      }
      this.gfxHalos.fill({ color: c, alpha: Math.min(0.52, k) });
    }

    /** Core disks: bucket by quantized radius × core alpha — limited SKUs. */
    const coreBuckets = new Map<string, StarDatum[]>();
    for (const s of this.stars) {
      const rk = snap(s.r, 400);
      const ak = snap(s.coreAlpha, 160);
      const key = `${rk}_${ak}`;
      let b = coreBuckets.get(key);
      if (!b) {
        b = [];
        coreBuckets.set(key, b);
      }
      b.push(s);
    }

    this.gfxStarCores.clear();
    for (const [, group] of coreBuckets.entries()) {
      const alphaPick = snap(group[0]!.coreAlpha, 160);
      for (const s of group) {
        this.gfxStarCores.circle(s.x, s.y, s.r);
      }
      this.gfxStarCores.fill({ color: c, alpha: Math.min(0.98, alphaPick) });
    }
  }

  tick(dtSeconds: number, latestPointer: PointerSample, pixiW: number, pixiH: number): void {
    if (dtSeconds <= 0) return;
    const dt = dtSeconds;
    const t = this.tuning;
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

    const fringe = bodyBleedMargin(pixiW, pixiH);

    const stepParticle = (
      x: number,
      y: number,
      vx: number,
      vy: number,
      ax: number,
      ay: number,
      massApprox: number
    ): { x: number; y: number; vx: number; vy: number } => {
      let fx = t.returnSpring * (ax - x);
      let fy = t.returnSpring * (ay - y);

      if (trailN > 0) {
        for (let i = 0; i < trailN; i++) {
          const ringIdx = (oldestIdx + i) % cap;
          const dx = x - this.trailX[ringIdx]!;
          const dy = y - this.trailY[ringIdx]!;
          const dist2 = dx * dx + dy * dy;
          if (dist2 > r2) continue;
          const dist = Math.sqrt(dist2) + 1e-4;
          const gated = 1 - dist / r;
          const base =
            (t.repulseStrength * this.trailW[ringIdx]! * gated * gated) /
            Math.max(massApprox, 0.25);
          fx += (dx / dist) * base;
          fy += (dy / dist) * base;
        }
      }

      let nvx = vx + fx * dt;
      let nvy = vy + fy * dt;
      nvx *= t.velocityDamping;
      nvy *= t.velocityDamping;
      const spd = Math.hypot(nvx, nvy);
      if (spd > t.maxSpeed) {
        const s = t.maxSpeed / spd;
        nvx *= s;
        nvy *= s;
      }

      const nx = x + nvx * dt;
      const ny = y + nvy * dt;
      return { x: nx, y: ny, vx: nvx, vy: nvy };
    };

    for (const s of this.stars) {
      const p = stepParticle(s.x, s.y, s.vx, s.vy, s.ax, s.ay, s.massApprox);
      s.vx = p.vx;
      s.vy = p.vy;
      s.x = p.x;
      s.y = p.y;

      const effHalf = s.r * (s.haloAlpha > 0 ? HALO_RADIUS_MULT * 0.42 : 1.06);
      const bleed = effHalf + fringe;
      bounceClamp(s, pixiW, pixiH, bleed);
    }

    for (const g of this.glyphs) {
      const p = stepParticle(g.x, g.y, g.vx, g.vy, g.ax, g.ay, g.massApprox);
      g.vx = p.vx;
      g.vy = p.vy;
      g.x = p.x;
      g.y = p.y;

      const hDot = extentsHalf(g.sprite.width, g.sprite.height);
      const bleed = hDot + fringe;
      bounceClamp(g, pixiW, pixiH, bleed);

      g.sprite.position.set(g.x, g.y);
    }

    this.redrawStars();
    this.lastPixiW = pixiW;
    this.lastPixiH = pixiH;
  }

  resize(pixiW: number, pixiH: number): void {
    const ow = Math.max(this.lastPixiW, 1);
    const oh = Math.max(this.lastPixiH, 1);
    const sx = pixiW / ow;
    const sy = pixiH / oh;
    for (const s of this.stars) {
      s.x *= sx;
      s.y *= sy;
      s.vx *= sx;
      s.vy *= sy;
      s.ax *= sx;
      s.ay *= sy;
      s.r *= (sx + sy) * 0.5;
    }
    for (const g of this.glyphs) {
      g.x *= sx;
      g.y *= sy;
      g.vx *= sx;
      g.vy *= sy;
      g.ax *= sx;
      g.ay *= sy;
      g.sprite.width *= sx;
      g.sprite.height *= sy;
    }
    const fringe = bodyBleedMargin(pixiW, pixiH);
    for (const s of this.stars) {
      const effHalf = s.r * (s.haloAlpha > 0 ? HALO_RADIUS_MULT * 0.42 : 1.06);
      const bleed = effHalf + fringe;
      squeezeClampPhys(s, pixiW, pixiH, bleed);
    }
    for (const g of this.glyphs) {
      const hDot = extentsHalf(g.sprite.width, g.sprite.height);
      const bleed = hDot + fringe;
      squeezeClampPhys(g, pixiW, pixiH, bleed);
      g.sprite.position.set(g.x, g.y);
    }
    const cap = this.trailCapacity();
    for (let i = 0; i < cap; i++) {
      this.trailX[i] = (this.trailX[i] ?? 0) * sx;
      this.trailY[i] = (this.trailY[i] ?? 0) * sy;
    }
    this.redrawStars();
    this.lastPixiW = pixiW;
    this.lastPixiH = pixiH;
  }

  dispose(): void {
    this.container.destroy({ children: true });
  }
}

function bounceClamp(o: Phys, pixiW: number, pixiH: number, bleed: number): void {
  const minX = -bleed + EDGE_SLIVER;
  const maxX = pixiW + bleed - EDGE_SLIVER;
  const minY = -bleed + EDGE_SLIVER;
  const maxY = pixiH + bleed - EDGE_SLIVER;

  if (o.x < minX) {
    o.x = minX;
    o.vx *= -0.35;
  } else if (o.x > maxX) {
    o.x = maxX;
    o.vx *= -0.35;
  }
  if (o.y < minY) {
    o.y = minY;
    o.vy *= -0.35;
  } else if (o.y > maxY) {
    o.y = maxY;
    o.vy *= -0.35;
  }
}

function squeezeClampPhys(o: Phys, pixiW: number, pixiH: number, bleed: number): void {
  const minX = -bleed + EDGE_SLIVER;
  const maxX = pixiW + bleed - EDGE_SLIVER;
  const minY = -bleed + EDGE_SLIVER;
  const maxY = pixiH + bleed - EDGE_SLIVER;
  o.x = clamp(o.x, minX, maxX);
  o.y = clamp(o.y, minY, maxY);
  o.ax = clamp(o.ax, minX, maxX);
  o.ay = clamp(o.ay, minY, maxY);
}

function extentsHalf(w: number, h: number): number {
  return Math.max(w, h) * 0.5;
}

function bodyBleedMargin(pxW: number, pxH: number): number {
  const minDim = Math.min(pxW, pxH);
  return Math.max(76, minDim * 0.085);
}

function playfieldOuterBounds(pxW: number, pxH: number, insetHalf: number): Bounds {
  const bleed = insetHalf + bodyBleedMargin(pxW, pxH);
  return {
    minX: -bleed + EDGE_SLIVER,
    maxX: pxW + bleed - EDGE_SLIVER,
    minY: -bleed + EDGE_SLIVER,
    maxY: pxH + bleed - EDGE_SLIVER,
  };
}

type Bounds = { minX: number; maxX: number; minY: number; maxY: number };

function sliceLayoutSeeds(pixiW: number, pixiH: number, targetCount: number): LayoutSeedsResult {
  const dots: Phys[] = [];
  const outer = playfieldOuterBounds(pixiW, pixiH, PLACEMENT_EXTENT_HALF);
  const { minX, maxX, minY, maxY } = outer;
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const viewArea = Math.max(pixiW * pixiH, 1);
  const playArea = spanX * spanY;
  const densityTarget = Math.max(targetCount, Math.round(targetCount * (playArea / viewArea)));
  let cols = Math.ceil(Math.sqrt(densityTarget * (spanX / Math.max(spanY, 1e-6))));
  cols = Math.max(1, cols);
  const rows = Math.ceil(densityTarget / cols);

  const stepX = spanX / cols;
  const stepY = spanY / rows;

  const ix0 = minX + PLACEMENT_EXTENT_HALF;
  const iy0 = minY + PLACEMENT_EXTENT_HALF;
  const ix1 = maxX - PLACEMENT_EXTENT_HALF;
  const iy1 = maxY - PLACEMENT_EXTENT_HALF;

  let idx = 0;
  for (let ry = 0; ry < rows; ry++) {
    for (let cx = 0; cx < cols; cx++) {
      const jitterX = seededJitter(idx, 17) * stepX * 0.42;
      const jitterY = seededJitter(idx, 91) * stepY * 0.42;
      const baseX = minX + (cx + 0.5) * stepX;
      const baseY = minY + (ry + 0.5) * stepY;
      const x = clamp(baseX + jitterX, ix0, ix1);
      const y = clamp(baseY + jitterY, iy0, iy1);
      dots.push({
        x,
        y,
        vx: 0,
        vy: 0,
        ax: x,
        ay: y,
        massApprox: 0.65 + (seededJitter(idx, 3) + 0.5) * 0.7,
      });
      idx++;
    }
  }

  const total = dots.length;
  const glyphBudget = Math.max(1, Math.round(total / GLYPH_SLOT_PERIOD));
  const permutation = shuffleIndexOrder(total, GLYPH_SHUFFLE_SEED);
  const glyphSlotIndices = new Set(permutation.slice(0, glyphBudget));

  return { seeds: dots, glyphSlotIndices };
}

/** Mulberry32 PRNG factory (deterministic floats in [0,1)). */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state += 0x6d2b79f5;
    let z = state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shuffles `[0 … length-1]` in place with seeded Fisher-Yates. */
function shuffleIndexOrder(length: number, seed: number): number[] {
  const a = Array.from({ length }, (_, i) => i);
  const rand = mulberry32(seed);
  for (let i = length - 1; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function seededJitter(i: number, salt: number) {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453123;
  return x - Math.floor(x) - 0.5;
}

function seededDeterministicUnit(i: number, salt: number): number {
  const x = Math.sin(i * 97.7372 + salt * 31.9241) * 98341.713;
  return x - Math.floor(x);
}

/** Permutation helper in [0,1) keyed by seed. */
function seedPerm03(i: number): number {
  const x = Math.sin(i * 444.9898 + 11.233) * 91823.8453123;
  return x - Math.floor(x);
}

function snap(a: number, quant: number): number {
  return Math.round(a * quant) / quant;
}
