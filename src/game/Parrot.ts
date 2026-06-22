import { Sprite, SpriteMaterial, Texture, Vector3 } from 'three';
import { Axis } from '../input/Input';
import { SpriteSpec } from './assets';

/**
 * The player. Game feel lives here:
 *  - velocity is eased toward the input (lerp), so the parrot glides instead of snapping;
 *  - it banks (texture rotates) into turns;
 *  - it bobs gently while idle.
 * Position is clamped to the flight lane.
 */

const MAX_SPEED_X = 9; // world units / s
const MAX_SPEED_Y = 6;
const EASE = 9; // higher = snappier
const LANE_X = 2.6;
const LANE_Y_MIN = 0.6;
const LANE_Y_MAX = 3.8;

export class Parrot {
  readonly sprite: Sprite;
  private vx = 0;
  private vy = 0;
  private bob = 0;

  constructor(texture: Texture, spec: SpriteSpec) {
    const material = new SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
    this.sprite = new Sprite(material);
    this.sprite.scale.set(spec.scale * spec.aspect, spec.scale, 1);
    this.sprite.position.set(0, 2, 3);
  }

  get position(): Vector3 {
    return this.sprite.position;
  }

  update(delta: number, axis: Axis): void {
    // Ease velocity toward the commanded direction.
    const k = Math.min(1, delta * EASE);
    this.vx += (axis.x * MAX_SPEED_X - this.vx) * k;
    this.vy += (axis.y * MAX_SPEED_Y - this.vy) * k;

    const p = this.sprite.position;
    p.x = clamp(p.x + this.vx * delta, -LANE_X, LANE_X);
    p.y = clamp(p.y + this.vy * delta, LANE_Y_MIN, LANE_Y_MAX);

    // Bank into the turn and idle-bob for life.
    this.bob += delta;
    const mat = this.sprite.material as SpriteMaterial;
    mat.rotation += (-this.vx * 0.05 - mat.rotation) * Math.min(1, delta * 8);
    this.sprite.position.y += Math.sin(this.bob * 4) * 0.02;
  }

  reset(): void {
    this.sprite.position.set(0, 2, 3);
    this.vx = this.vy = 0;
    (this.sprite.material as SpriteMaterial).rotation = 0;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
