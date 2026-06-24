import {
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Scene,
  Sprite,
  SpriteMaterial,
  Texture,
} from 'three';
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
const FLOOR_Y = -0.4; // matches the scrolling ground plane in Game.ts (trees stand on it)
const TREE_X = 4.2; // consistent roadside distance — trees line the route like freeway lamp posts

interface Item {
  sprite: Sprite;
  baseScaleX: number;
  baseScaleY: number;
  collected: boolean;
  popT: number;
  phase: number; // per-item offset so they don't bob in lockstep
  baseY: number; // resting height, around which the fruit bobs
}

// Trees are FIXED-orientation planes (not camera-facing billboards), so as you fly past they show
// real perspective foreshortening — like driving past roadside lamp posts, not turning signs.
interface Tree {
  mesh: Mesh;
  halfHeight: number;
}

export class Spawner {
  private fruit: Item[] = [];
  private trees: Tree[] = [];
  private sinceFruit = 0;
  private sinceTree = 0;
  private treeSide = 1;
  private time = 0;

  constructor(
    private scene: Scene,
    private fruitTextures: Texture[],
    treeTex: Texture,
    private fruitSpec: SpriteSpec,
    treeSpec: SpriteSpec,
    private config: GameConfig
  ) {
    for (let i = 0; i < FRUIT_POOL; i++) this.fruit.push(this.make(fruitTextures[0], fruitSpec));
    for (let i = 0; i < TREE_POOL; i++) this.trees.push(this.makeTree(treeTex, treeSpec));
  }

  /** Fruit = camera-facing billboard sprite (a collectible you look straight at). */
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

  /** Tree = fixed-orientation textured plane (a roadside prop you fly past, not a billboard). */
  private makeTree(tex: Texture, spec: SpriteSpec): Tree {
    const w = spec.scale * spec.aspect;
    const h = spec.scale;
    const mat = new MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      fog: true,
    });
    const mesh = new Mesh(new PlaneGeometry(w, h), mat);
    mesh.visible = false;
    this.scene.add(mesh);
    return { mesh, halfHeight: h / 2 };
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
    for (const t of this.trees) {
      if (!t.mesh.visible) continue;
      t.mesh.position.z += move;
      if (t.mesh.position.z > RECYCLE_Z) t.mesh.visible = false;
    }

    // Spawn ahead based on distance travelled.
    this.sinceFruit += move;
    if (this.sinceFruit >= jitter(this.config.fruitGap)) {
      this.sinceFruit = 0;
      this.spawnFruit();
    }
    this.sinceTree += move;
    if (this.sinceTree >= this.config.treeGap) {
      // Even spacing (no jitter) so trees pass at a steady rhythm, like roadside lamp posts.
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
    // Pick a random fruit variety per spawn so the lane shows mixed kinds (like the reference).
    mat.map = this.fruitTextures[Math.floor(Math.random() * this.fruitTextures.length)];
    mat.needsUpdate = true;
    mat.opacity = 1;
    mat.rotation = 0;
    it.sprite.scale.set(it.baseScaleX, it.baseScaleY, 1);
    it.sprite.position.set(rand(-2.4, 2.4), it.baseY, SPAWN_Z);
    it.sprite.visible = true;
  }

  private spawnTree(): void {
    const t = this.trees.find((tr) => !tr.mesh.visible);
    if (!t) return;
    // Lined along the route at a consistent roadside distance, alternating sides (lamp-post rows).
    const x = this.treeSide * (TREE_X + rand(-0.3, 0.5));
    this.treeSide *= -1;
    // Grounded: the base of the tree sits on the scrolling floor, so it reads as a fixed prop.
    t.mesh.position.set(x, FLOOR_Y + t.halfHeight, SPAWN_Z);
    t.mesh.visible = true;
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
    this.fruit.forEach((it) => this.retire(it));
    this.trees.forEach((t) => (t.mesh.visible = false));
    this.sinceFruit = this.sinceTree = 0;
  }
}

function rand(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}
function jitter(base: number): number {
  return base * (0.7 + Math.random() * 0.6);
}
