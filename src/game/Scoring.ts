/**
 * Pure scoring + run-state helpers. No three.js, no DOM. Unit-tested.
 *
 * A small combo multiplier rewards picking up fruit in quick succession: this is "juice" that is
 * still deterministic and testable, not a vague feel tweak.
 */

export const COMBO_WINDOW_S = 1.5; // pickups within this gap keep the combo alive
export const COMBO_STEP = 0.25; // each chained pickup adds 25% up to the cap
export const COMBO_MAX = 3; // multiplier cap (x3)

/** Multiplier for the Nth pickup in a chain (chain=1 -> x1, chain=2 -> x1.25, ...). */
export function comboMultiplier(chain: number): number {
  const m = 1 + Math.max(0, chain - 1) * COMBO_STEP;
  return Math.min(m, COMBO_MAX);
}

/** Whether a pickup at `now` continues the chain started/continued at `lastPickupAt`. */
export function continuesCombo(now: number, lastPickupAt: number): boolean {
  return now - lastPickupAt <= COMBO_WINDOW_S;
}

/** Points a pickup is worth given its base value and the current chain length. */
export function pickupValue(basePoints: number, chain: number): number {
  return Math.round(basePoints * comboMultiplier(chain));
}

/** Has the run finished? Distance-based completion. */
export function isRunComplete(distanceTravelled: number, runDistance: number): boolean {
  return distanceTravelled >= runDistance;
}

/** 0..1 progress through the run, clamped. Drives the progress bar. */
export function runProgress(distanceTravelled: number, runDistance: number): number {
  if (runDistance <= 0) return 1;
  return Math.min(1, Math.max(0, distanceTravelled / runDistance));
}
