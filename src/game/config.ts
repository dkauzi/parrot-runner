/**
 * Config-driven variants. THE product-native touch: a Seepia playable is produced as many
 * variants from one engine. Here the whole game is parameterised, so a new ad variant is a
 * config entry, not a code change. The same generate -> validate -> grade pipeline that gates
 * sprites would gate these variants at scale.
 *
 * Select at runtime with ?variant=rush (default: classic).
 */

export interface GameConfig {
  /** Variant id, surfaced in the HUD and used by the pipeline as the artifact name. */
  name: string;
  /** How far (world units) the parrot flies before the run ends. */
  runDistance: number;
  /** Forward scroll speed (world units / second). */
  scrollSpeed: number;
  /** Average gap (world units) between collectible spawns. Smaller = denser. */
  fruitGap: number;
  /** Average gap between environment trees. */
  treeGap: number;
  /** Base points per fruit before combo multiplier. */
  fruitPoints: number;
  /** Fruit tint (the visible difference between themes), CSS-style hex. */
  fruitColor: number;
  /** Display label for the start screen. */
  title: string;
}

const CLASSIC: GameConfig = {
  name: 'classic',
  runDistance: 600,
  scrollSpeed: 18,
  fruitGap: 7,
  treeGap: 9,
  fruitPoints: 10,
  fruitColor: 0xffb300, // mango
  title: 'Parrot Runner',
};

export const VARIANTS: Record<string, GameConfig> = {
  classic: CLASSIC,
  // Faster, denser, shorter: a high-intensity variant.
  rush: {
    ...CLASSIC,
    name: 'rush',
    scrollSpeed: 26,
    fruitGap: 5,
    runDistance: 500,
    fruitColor: 0xff5252, // lychee red
    title: 'Parrot Runner: Rush',
  },
  // Slower, calmer, longer: an easy/onboarding variant.
  zen: {
    ...CLASSIC,
    name: 'zen',
    scrollSpeed: 13,
    fruitGap: 8,
    runDistance: 520,
    fruitColor: 0x66bb6a, // green guava
    title: 'Parrot Runner: Zen',
  },
};

/** Resolve the requested variant, plus the fast-end test override. */
export function resolveConfig(search: string): { config: GameConfig; fastEnd: boolean } {
  const params = new URLSearchParams(search);
  const variant = params.get('variant') ?? 'classic';
  const base = VARIANTS[variant] ?? VARIANTS.classic;
  const fastEnd = params.get('test') === 'fastend';
  // Fast-end shrinks the run so automated tests reach the end card in ~2s.
  const config = fastEnd ? { ...base, runDistance: base.scrollSpeed * 2 } : base;
  return { config, fastEnd };
}
