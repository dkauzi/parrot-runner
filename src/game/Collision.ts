/**
 * Pure collision helpers. No three.js, no DOM: just numbers, so this is trivially unit-testable
 * and runnable under `node --test`. This is the deterministic core of the game; AI was not used
 * to "improvise physics" here, it is plain, checkable math.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Squared distance: avoids a sqrt in the hot loop. */
export function distanceSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/** True when two points are within `reach` of each other (sphere overlap). */
export function within(a: Vec3, b: Vec3, reach: number): boolean {
  return distanceSq(a, b) <= reach * reach;
}

/**
 * Returns the indices of items the parrot is currently touching. Index-based so the caller can
 * recycle the exact sprites without re-deriving identity.
 */
export function collect(parrot: Vec3, items: Vec3[], reach: number): number[] {
  const hits: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (within(parrot, items[i], reach)) hits.push(i);
  }
  return hits;
}
