import { CanvasTexture, SRGBColorSpace, Texture, TextureLoader } from 'three';
import manifest from '../../assets/assets.json';

/**
 * Asset layer.
 *
 * Two jobs:
 *  1. Validate the manifest at boot (the "schema validation before downstream systems" rule):
 *     a bad manifest fails LOUD here, not as a broken sprite mid-run.
 *  2. Provide textures. Placeholders are drawn procedurally so the game runs with zero asset
 *     files and the single-file playable build stays self-contained. To ship the real
 *     AI-generated sprites, drop PNGs in assets/sprites/, gate them with pipeline/validate.mjs,
 *     and swap the procedural generators for `new TextureLoader().load(import('...png'))`.
 */

export interface SpriteSpec {
  scale: number;
  aspect: number;
  points?: number;
}

export interface Manifest {
  sprites: Record<'parrot' | 'fruit' | 'tree', SpriteSpec>;
}

/** Minimal, dependency-free manifest check mirroring assets.schema.json. Fails loud. */
export function validateManifest(m: unknown): Manifest {
  const sprites = (m as Manifest)?.sprites;
  if (!sprites) throw new Error('assets.json: missing "sprites"');
  for (const key of ['parrot', 'fruit', 'tree'] as const) {
    const s = sprites[key];
    if (!s) throw new Error(`assets.json: missing sprite "${key}"`);
    if (!(s.scale > 0)) throw new Error(`assets.json: ${key}.scale must be > 0`);
    if (!(s.aspect > 0)) throw new Error(`assets.json: ${key}.aspect must be > 0`);
  }
  if (typeof sprites.fruit.points !== 'number') {
    throw new Error('assets.json: fruit.points must be a number');
  }
  return m as Manifest;
}

export const MANIFEST: Manifest = validateManifest(manifest);

/**
 * Discover real sprite PNGs dropped into assets/sprites/ (parrot.png, fruit.png, tree.png).
 * webpack inlines each as a base64 data URL (asset/inline), so the single-file build stays
 * self-contained. If a sprite is absent we fall back to the procedural placeholder, so the game
 * always runs. To ship the AI-generated art: add the PNGs, gate them with pipeline/validate.mjs.
 */
const SPRITE_URLS: Partial<Record<'parrot' | 'fruit' | 'tree', string>> = (() => {
  const map: Record<string, string> = {};
  try {
    const ctx = require.context('../../assets/sprites', false, /\.png$/);
    for (const key of ctx.keys()) {
      const name = key.replace(/^\.\//, '').replace(/\.png$/, '');
      const mod = ctx(key);
      map[name] = typeof mod === 'string' ? mod : (mod as { default: string }).default;
    }
  } catch {
    /* no sprites dir at build time -> everything stays procedural */
  }
  return map;
})();

const loader = new TextureLoader();
function fromUrl(url: string): Texture {
  const t = loader.load(url); // returns immediately, fills in asynchronously
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Parrot texture: real PNG if present, else procedural placeholder. */
export function makeParrotTexture(): Texture {
  return SPRITE_URLS.parrot ? fromUrl(SPRITE_URLS.parrot) : proceduralParrot();
}
/** Fruit texture: real PNG if present (tint ignored), else procedural placeholder tinted per variant. */
export function makeFruitTexture(color: number): Texture {
  return SPRITE_URLS.fruit ? fromUrl(SPRITE_URLS.fruit) : proceduralFruit(color);
}
/** Tree texture: real PNG if present, else procedural placeholder. */
export function makeTreeTexture(): Texture {
  return SPRITE_URLS.tree ? fromUrl(SPRITE_URLS.tree) : proceduralTree();
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

function texture(c: HTMLCanvasElement): Texture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Parrot seen from behind, wings spread: a clear silhouette over a busy background. */
function proceduralParrot(): Texture {
  const [c, ctx] = canvas(180, 128);
  const body = '#e53935';
  // tail
  ctx.fillStyle = '#d32f2f';
  ctx.beginPath();
  ctx.moveTo(90, 70);
  ctx.lineTo(80, 124);
  ctx.lineTo(100, 124);
  ctx.closePath();
  ctx.fill();
  // wings (left + right), banded for colour
  const bands = ['#1e88e5', '#43a047', '#fdd835'];
  for (const dir of [-1, 1]) {
    bands.forEach((col, i) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(90, 56);
      ctx.lineTo(90 + dir * (30 + i * 26), 40 + i * 22);
      ctx.lineTo(90 + dir * (18 + i * 22), 72 + i * 14);
      ctx.closePath();
      ctx.fill();
    });
  }
  // body
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(90, 60, 16, 30, 0, 0, Math.PI * 2);
  ctx.fill();
  // head
  ctx.fillStyle = '#ef5350';
  ctx.beginPath();
  ctx.arc(90, 34, 13, 0, Math.PI * 2);
  ctx.fill();
  return texture(c);
}

/** A round fruit, tinted per variant, with a highlight so it pops. */
function proceduralFruit(color: number): Texture {
  const [c, ctx] = canvas(96, 96);
  const hex = '#' + color.toString(16).padStart(6, '0');
  const g = ctx.createRadialGradient(38, 34, 6, 48, 48, 46);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.25, hex);
  g.addColorStop(1, shade(hex, -0.35));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(48, 50, 40, 0, Math.PI * 2);
  ctx.fill();
  // leaf
  ctx.fillStyle = '#2e7d32';
  ctx.beginPath();
  ctx.ellipse(60, 14, 12, 6, -0.7, 0, Math.PI * 2);
  ctx.fill();
  return texture(c);
}

/** A jungle tree: trunk + layered canopy. Anchored so the base sits on the scroll plane. */
function proceduralTree(): Texture {
  const [c, ctx] = canvas(120, 220);
  ctx.fillStyle = '#6d4c41';
  ctx.fillRect(52, 120, 16, 96);
  const greens = ['#2e7d32', '#388e3c', '#43a047'];
  greens.forEach((col, i) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(60, 70 - i * 6 + i * 0, 46 - i * 8, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = '#388e3c';
  ctx.beginPath();
  ctx.arc(36, 96, 26, 0, Math.PI * 2);
  ctx.arc(86, 92, 28, 0, Math.PI * 2);
  ctx.fill();
  return texture(c);
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp((n >> 16) + amt * 255);
  const g = clamp(((n >> 8) & 0xff) + amt * 255);
  const b = clamp((n & 0xff) + amt * 255);
  return `rgb(${r},${g},${b})`;
}
function clamp(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}
