import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  comboMultiplier,
  continuesCombo,
  pickupValue,
  isRunComplete,
  runProgress,
  COMBO_MAX,
} from '../../src/game/Scoring.ts';

test('comboMultiplier grows then caps', () => {
  assert.equal(comboMultiplier(1), 1);
  assert.equal(comboMultiplier(2), 1.25);
  assert.equal(comboMultiplier(100), COMBO_MAX);
});

test('continuesCombo respects the time window', () => {
  assert.equal(continuesCombo(10, 9), true); // 1s gap
  assert.equal(continuesCombo(10, 7), false); // 3s gap
});

test('pickupValue applies and rounds the multiplier', () => {
  assert.equal(pickupValue(10, 1), 10);
  assert.equal(pickupValue(10, 2), 13); // 10 * 1.25 = 12.5 -> 13
});

test('isRunComplete triggers at the distance limit', () => {
  assert.equal(isRunComplete(599, 600), false);
  assert.equal(isRunComplete(600, 600), true);
});

test('runProgress is clamped to 0..1', () => {
  assert.equal(runProgress(0, 600), 0);
  assert.equal(runProgress(300, 600), 0.5);
  assert.equal(runProgress(900, 600), 1);
});
