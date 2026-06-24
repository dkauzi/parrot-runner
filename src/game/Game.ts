import {
  Clock,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  Texture,
  TextureLoader,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GameConfig } from './config';
import { MANIFEST, makeCollectibleTextures, makeTreeTexture } from './assets';
import { Parrot } from './Parrot';
import { Spawner } from './Spawner';
import { collect } from './Collision';
import {
  continuesCombo,
  comboMultiplier,
  isRunComplete,
  pickupValue,
  runProgress,
} from './Scoring';
import { Input } from '../input/Input';
import { UI } from '../ui/ui';
import { blip, endChime, startChime, unlockAudio } from './audio';
import { ensureMraid, fireCta } from '../mraid';
import bgUrl from '../../assets/background.jpg'; // AI-generated jungle backdrop
import groundUrl from '../../assets/ground.jpg'; // AI-generated jungle-floor texture (scrolls)

type State = 'menu' | 'playing' | 'gameover';

const PICKUP_REACH = 1.2;
const FOG_COLOR = 0x9ed27a;
// The bird flies forward through a FIXED world (like a race car on a track). The camera + bird move
// in -z; the ground follows the camera so it reads as a stable floor while trees/fruit pass.
const CAM_Z0 = 8.5; // camera's starting z
const PARROT_Z0 = 3; // bird's starting z (5.5 in front of the camera)
const GROUND_AHEAD = 100; // how far ahead of the camera the floor plane is centred

export class Game {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera: PerspectiveCamera;
  private clock = new Clock();
  private parrot: Parrot;
  private spawner: Spawner;
  private input: Input;
  private ui: UI;

  private state: State = 'menu';
  private score = 0;
  private distance = 0;
  private elapsed = 0;
  private chain = 0;
  private pickups = 0;
  private lastPickupAt = -999;

  private fpsSmoothed = 60;
  private fpsTimer = 0;
  private shakeT = 0;
  private camBase: Vector3;
  private ground!: Mesh;
  private groundTex: Texture | null = null;
  private startMs = 0;
  private frames = 0;

  constructor(
    private root: HTMLElement,
    private config: GameConfig,
    private fastEnd: boolean
  ) {
    this.renderer = new WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true, // lets tests + visual QA screenshot the WebGL canvas
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // cap framebuffer for FPS
    this.renderer.setClearColor(0x000000, 0);
    root.appendChild(this.renderer.domElement);

    // AI-generated jungle backdrop behind the transparent WebGL canvas (matches the concept art).
    root.style.backgroundImage = `url(${bgUrl})`;
    root.style.backgroundSize = 'cover';
    root.style.backgroundPosition = 'center';

    this.scene.background = null;
    this.scene.fog = new Fog(FOG_COLOR, 12, 42);

    // Lights so the 3D parrot model is lit (sprites are unlit and ignore these).
    const hemi = new HemisphereLight(0xffffff, 0x4f7a3a, 1.1);
    const sun = new DirectionalLight(0xffffff, 1.6);
    sun.position.set(2, 5, 4);
    this.scene.add(hemi, sun);

    // Static jungle FLOOR — a stable ground reference (AI-textured). Motion is carried by the
    // trees and fruit passing the camera (like fixed lamp posts on a freeway), not by the ground.
    const groundTex = new TextureLoader().load(groundUrl);
    groundTex.wrapS = groundTex.wrapT = RepeatWrapping;
    groundTex.repeat.set(4, 24); // texture is offset-blended seamless (make-seamless.mjs) -> no seams
    // Tint green (multiplies the texture) so any stray pink/purple in the AI floor reads as jungle.
    const ground = new Mesh(
      new PlaneGeometry(60, 240),
      new MeshBasicMaterial({ map: groundTex, fog: true, color: 0x93c47d })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.4, -100);
    this.scene.add(ground);
    this.ground = ground;
    this.groundTex = groundTex;

    this.camera = new PerspectiveCamera(55, 1, 0.1, 100);
    this.camera.position.set(0, 2.6, 8.5);
    this.camera.lookAt(0, 1.8, -6);
    this.camBase = this.camera.position.clone();

    const s = MANIFEST.sprites;
    this.parrot = new Parrot(s.parrot);
    this.scene.add(this.parrot.object);
    this.spawner = new Spawner(
      this.scene,
      makeCollectibleTextures(config.fruitColor),
      makeTreeTexture(),
      s.fruit,
      s.tree,
      config
    );
    this.spawner.prepopulate(PARROT_Z0); // populate the path for the attract/menu screen

    this.input = new Input(root);
    this.ui = new UI(root, config.title);
    this.ui.onStart(() => this.begin());
    this.ui.onReplay(() => this.begin());
    this.ui.onCta(() => fireCta());

    ensureMraid();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  start(): void {
    this.renderer.setAnimationLoop(() => this.tick());
    // Test hook: let headless tests stop the loop so the WebGL context tears down cleanly
    // (software-GL teardown can hang while a heavy render loop is still running).
    (window as unknown as { __stopLoop: () => void }).__stopLoop = () =>
      this.renderer.setAnimationLoop(null);
    // Auto-start under the fast-end test hook so the run reaches the end card unattended.
    if (this.fastEnd) this.begin();
  }

  private begin(): void {
    unlockAudio();
    startChime();
    this.spawner.reset();
    this.spawner.prepopulate(PARROT_Z0); // fresh populated path at the start of the run
    this.parrot.reset();
    this.score = 0;
    this.pickups = 0;
    this.distance = 0;
    this.elapsed = 0;
    this.chain = 0;
    this.lastPickupAt = -999;
    this.ui.hideStart();
    this.ui.hideEnd();
    this.ui.setScore(0);
    this.ui.setProgress(0);
    this.startMs = performance.now();
    this.state = 'playing';
  }

  private end(): void {
    this.state = 'gameover';
    endChime();
    this.ui.showEnd(this.score);

    // Gameplay telemetry — the SEED of the performance flywheel (the data we're "blind to" today):
    // which variant, how many pickups, how long. A backend would collect this to pick the winning
    // asset/variant by real play, not just the aesthetic rubric. Here we emit it on a global hook.
    const telemetry = {
      variant: this.config.name,
      score: this.score,
      pickups: this.pickups,
      durationS: Math.round(this.elapsed),
      at: new Date().toISOString(),
    };
    (window as unknown as { __telemetry: unknown }).__telemetry = telemetry;
    // eslint-disable-next-line no-console
    console.log('[telemetry]', JSON.stringify(telemetry));
  }

  private tick(): void {
    const delta = Math.min(this.clock.getDelta(), 0.05); // clamp huge frames (tab refocus)
    const playing = this.state === 'playing';

    this.parrot.update(delta, playing ? this.input.getAxis() : { x: 0, y: 0 });
    if (playing) {
      this.elapsed += delta;
      this.distance += this.config.scrollSpeed * delta; // bird advances forward
    }

    // Fly the bird + camera forward through the FIXED world; the floor follows the camera.
    const camZ = CAM_Z0 - this.distance;
    const parrotZ = PARROT_Z0 - this.distance;
    this.parrot.position.z = parrotZ;
    // Floor plane follows the camera so it always covers the view, BUT its texture offset is tied
    // to forward distance — so the ground rushes UNDER you (world-fixed look) = the sense of speed.
    this.ground.position.z = camZ - GROUND_AHEAD;
    if (this.groundTex) this.groundTex.offset.y = this.distance * 0.125;
    this.camBase.set(0, 2.6, camZ);

    const move = playing ? this.config.scrollSpeed * delta : 0;
    this.spawner.update(delta, move, parrotZ);

    if (playing) {
      this.ui.setProgress(runProgress(this.distance, this.config.runDistance));
      this.handlePickups();
      const done = this.fastEnd
        ? performance.now() - this.startMs > 1500
        : isRunComplete(this.distance, this.config.runDistance);
      if (done) this.end();
    }

    this.updateFps(delta);
    this.applyShake(delta); // positions the camera from camBase (+ shake)
    this.camera.lookAt(this.parrot.position.x * 0.2, 2.0, camZ - 16); // look level down the path (not steeply down)
    this.renderer.render(this.scene, this.camera);

    // Heartbeat for the headless test: proves the real game loop is advancing (cheaper and more
    // meaningful than reading back pixels under software GL).
    this.frames++;
    (window as unknown as { __frames: number }).__frames = this.frames;
  }

  private handlePickups(): void {
    const fruit = this.spawner.activeFruit();
    if (fruit.length === 0) return;
    const positions = fruit.map((f) => f.sprite.position);
    const hits = collect(this.parrot.position, positions, PICKUP_REACH);
    for (const i of hits) {
      this.chain = continuesCombo(this.elapsed, this.lastPickupAt) ? this.chain + 1 : 1;
      this.lastPickupAt = this.elapsed;
      this.score += pickupValue(this.config.fruitPoints, this.chain);
      this.pickups++;
      this.spawner.pickup(fruit[i]);
      this.ui.setScore(this.score);
      this.ui.flashCombo(comboMultiplier(this.chain));
      blip(this.chain);
      this.shakeT = 0.12; // screen-space punch on pickup
    }
  }

  private updateFps(delta: number): void {
    if (delta > 0) this.fpsSmoothed += (1 / delta - this.fpsSmoothed) * 0.1;
    this.fpsTimer += delta;
    if (this.fpsTimer >= 0.25) {
      this.fpsTimer = 0;
      this.ui.setFps(this.fpsSmoothed);
    }
  }

  private applyShake(delta: number): void {
    if (this.shakeT > 0) {
      this.shakeT = Math.max(0, this.shakeT - delta);
      const m = this.shakeT * 1.2;
      this.camera.position.set(
        this.camBase.x + (Math.random() - 0.5) * m,
        this.camBase.y + (Math.random() - 0.5) * m,
        this.camBase.z
      );
    } else {
      this.camera.position.copy(this.camBase);
    }
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }
}
