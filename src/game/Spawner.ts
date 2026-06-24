import { Scene, Sprite, SpriteMaterial, Texture } from 'three';
import { GameConfig } from './config';
import { SpriteSpec } from './assets';

/**
 * Spawns, scrolls, and recycles the world via object pools, so steady-state allocates nothing
 * per frame (the FPS budget depends on this). Fruit are collectible; trees are environment.
 * Collected fruit play a brief "pop" (scale up + fade) before returning to the pool.
 */

const SPAWN_Z = -40; // where objects appear (far, fades in through fog)
const RECYCLE_Z = 8; // behind the camera -> recycle
const POP_TIME = 0.22;
const FRUIT_POOL = 28;
const TREE_POOL = 18;

interface Item {
  sprite: Sprite;
  baseScaleX: number;
  baseScaleY: number;
  collected: boolean;
  popT: number;
  phase: number; // per-item offset so they don't bob in lockstep
  baseY: number; // resting height, around which the fruit bobs
}

export class Spawner {
  private fruit: Item[] = [];
  private trees: Item[] = [];
  private sinceFruit = 0;
  private sinceTree = 0;
  private treeSide = 1;
  private time = 0;

  constructor(
    private scene: Scene,
    fruitTex: Texture,
    treeTex: Texture,
    private fruitSpec: SpriteSpec,
    treeSpec: SpriteSpec,
    private config: GameConfig
  ) {
    for (let i = 0; i < FRUIT_POOL; i++) this.fruit.push(this.make(fruitTex, fruitSpec));
    for (let i = 0; i < TREE_POOL; i++) this.trees.push(this.make(treeTex, treeSpec));
  }

  private make(tex: Texture, spec: SpriteSpec): Item {
    const mat = new SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const sprite = new Sprite(mat);
    const sx = spec.scale * spec.aspect;
    const sy = spec.scale;
    sprite.scale.set(sx, sy, 1);
    sprite.visible = false;
    this.scene.add(sprite);
    return { sprite, baseScaleX: sx, baseScaleY: sy, collected: false, popT: 0, phase: 0, baseY: 0 };
  }

  /** Advance the world one frame. */
  update(delta: number): void {
    const move = this.config.scrollSpeed * delta;
    this.time += delta;

    for (const it of this.fruit) {
      if (!it.sprite.visible) continue;
      it.sprite.position.z += move;
      if (it.collected) {
        it.popT -= delta;
        const t = Math.max(0, it.popT) / POP_TIME;
        const grow = 1 + (1 - t) * 0.8;
        it.sprite.scale.set(it.baseScaleX * grow, it.baseScaleY * grow, 1);
        (it.sprite.material as SpriteMaterial).opacity = t;
        if (it.popT <= 0) this.retire(it);
      } else if (it.sprite.position.z > RECYCLE_Z) {
        this.retire(it);
      } else {
        // Alive: gentle bob around the resting height + a slow spin, so fruit feels collectible.
        it.sprite.position.y = it.baseY + Math.sin(this.time * 2 + it.phase) * 0.12;
        (it.sprite.material as SpriteMaterial).rotation += delta * 0.7;
      }
    }
    for (const it of this.trees) {
      if (!it.sprite.visible) continue;
      it.sprite.position.z += move;
      if (it.sprite.position.z > RECYCLE_Z) it.sprite.visible = false;
    }

    // Spawn ahead based on distance travelled.
    this.sinceFruit += move;
    if (this.sinceFruit >= jitter(this.config.fruitGap)) {
      this.sinceFruit = 0;
      this.spawnFruit();
    }
    this.sinceTree += move;
    if (this.sinceTree >= jitter(this.config.treeGap)) {
      this.sinceTree = 0;
      this.spawnTree();
    }
  }

  private retire(it: Item): void {
    it.sprite.visible = false;
    it.collected = false;
    it.sprite.scale.set(it.baseScaleX, it.baseScaleY, 1);
    (it.sprite.material as SpriteMaterial).opacity = 1;
  }

  private spawnFruit(): void {
    const it = this.fruit.find((f) => !f.sprite.visible);
    if (!it) return;
    it.collected = false;
    it.popT = 0;
    it.phase = Math.random() * Math.PI * 2;
    it.baseY = rand(1.0, 3.4);
    const mat = it.sprite.material as SpriteMaterial;
    mat.opacity = 1;
    mat.rotation = 0;
    it.sprite.scale.set(it.baseScaleX, it.baseScaleY, 1);
    it.sprite.position.set(rand(-2.4, 2.4), it.baseY, SPAWN_Z);
    it.sprite.visible = true;
  }

  private spawnTree(): void {
    const it = this.trees.find((t) => !t.sprite.visible);
    if (!it) return;
    const x = this.treeSide * rand(3.4, 5.2);
    this.treeSide *= -1;
    it.sprite.position.set(x, 1.4, SPAWN_Z);
    it.sprite.visible = true;
  }

  /** Collectible fruit currently in play (visible and not already collected). */
  activeFruit(): Item[] {
    return this.fruit.filter((f) => f.sprite.visible && !f.collected);
  }

  /** Trigger the pickup pop on a specific fruit. */
  pickup(it: Item): void {
    it.collected = true;
    it.popT = POP_TIME;
  }

  reset(): void {
    [...this.fruit, ...this.trees].forEach((it) => this.retire(it));
    this.sinceFruit = this.sinceTree = 0;
  }
}

function rand(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}
function jitter(base: number): number {
  return base * (0.7 + Math.random() * 0.6);
}
