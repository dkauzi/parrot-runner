import { AnimationMixer, Box3, Group, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { Axis } from '../input/Input';
import { SpriteSpec } from './assets';
import parrotUrl from '../../assets/Parrot.glb';

/**
 * The player: a rigged, animated 3D parrot (so the WINGS ACTUALLY FLAP) instead of a flat image.
 *
 * Game-feel design:
 *  - real wing-flap comes from the model's baked animation, driven by an AnimationMixer;
 *  - movement is momentum-based (velocity eases toward input) - inertia, not gravity, which is the
 *    right physics for a free-flight collectathon;
 *  - the body banks (rolls) into turns and bobs as it flies.
 *
 * The model loads asynchronously; an empty group sits at the player position immediately so the
 * game can read `position` and add `object` to the scene before the model arrives.
 */

const MAX_SPEED_X = 9;
const MAX_SPEED_Y = 6;
const EASE = 9;
const LANE_X = 2.6;
const LANE_Y_MIN = 0.6;
const LANE_Y_MAX = 3.8;
const Z = 3;
// The model's default forward is +Z (faces the camera); rotate 180° so we see its back as it flies
// away from us. If it ever faces the wrong way, this is the single knob to turn.
const FACING_Y = Math.PI;

export class Parrot {
  readonly object: Group; // position + bank (added to the scene)
  private facing: Group; // holds the model at its facing orientation
  private mixer: AnimationMixer | null = null;
  private vx = 0;
  private vy = 0;
  private t = 0;

  constructor(spec: SpriteSpec) {
    this.object = new Group();
    this.object.position.set(0, 2, Z);
    this.facing = new Group();
    this.facing.rotation.y = FACING_Y; // yaw to face away from the camera (we see its back)
    this.object.add(this.facing);
    this.load(spec.scale);
  }

  private load(targetHeight: number): void {
    new GLTFLoader().load(parrotUrl, (gltf) => {
      const model = gltf.scene;
      // Center on its bounding box and scale to a consistent on-screen height.
      const box = new Box3().setFromObject(model);
      const size = new Vector3();
      const center = new Vector3();
      box.getSize(size);
      box.getCenter(center);
      const scale = (targetHeight * 1.6) / (size.y || 1);
      model.scale.setScalar(scale);
      model.position.sub(center.multiplyScalar(scale));
      this.facing.add(model);

      if (gltf.animations.length) {
        this.mixer = new AnimationMixer(model);
        const action = this.mixer.clipAction(gltf.animations[0]); // the wing-flap clip
        action.timeScale = 1.4; // a touch faster = livelier flap
        action.play();
      }
    });
  }

  get position(): Vector3 {
    return this.object.position;
  }

  update(delta: number, axis: Axis): void {
    if (this.mixer) this.mixer.update(delta); // drive the wing-flap

    const k = Math.min(1, delta * EASE);
    this.vx += (axis.x * MAX_SPEED_X - this.vx) * k;
    this.vy += (axis.y * MAX_SPEED_Y - this.vy) * k;

    const p = this.object.position;
    p.x = clamp(p.x + this.vx * delta, -LANE_X, LANE_X);
    p.y = clamp(p.y + this.vy * delta, LANE_Y_MIN, LANE_Y_MAX);

    // Bank (roll) into turns; gentle climb/dive pitch; subtle bob.
    this.t += delta;
    this.object.rotation.z += (-this.vx * 0.06 - this.object.rotation.z) * Math.min(1, delta * 8);
    this.object.rotation.x += (this.vy * 0.04 - this.object.rotation.x) * Math.min(1, delta * 8);
    p.y += Math.sin(this.t * 3) * 0.015;
  }

  reset(): void {
    this.vx = this.vy = 0;
    this.t = 0;
    this.object.position.set(0, 2, Z);
    this.object.rotation.set(0, 0, 0);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
