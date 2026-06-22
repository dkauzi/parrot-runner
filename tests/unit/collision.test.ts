import { test } from 'node:test';
import assert from 'node:assert/strict';
import { within, collect, distanceSq } from '../../src/game/Collision.ts';

test('within: overlapping points are a hit', () => {
  assert.equal(within({ x: 0, y: 0, z: 0 }, { x: 0.5, y: 0, z: 0 }, 1), true);
});

test('within: points beyond reach are not a hit', () => {
  assert.equal(within({ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, 1), false);
});

test('within: exactly at reach is inclusive', () => {
  assert.equal(within({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 1), true);
});

test('distanceSq matches the math', () => {
  assert.equal(distanceSq({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 }), 25);
});

test('collect returns indices of all touched items', () => {
  const parrot = { x: 0, y: 0, z: 0 };
  const items = [
    { x: 0.2, y: 0, z: 0 }, // hit
    { x: 5, y: 0, z: 0 }, // miss
    { x: 0, y: 0.9, z: 0 }, // hit
  ];
  assert.deepEqual(collect(parrot, items, 1), [0, 2]);
});

test('collect returns empty when nothing is near', () => {
  assert.deepEqual(collect({ x: 0, y: 0, z: 0 }, [{ x: 9, y: 9, z: 9 }], 1), []);
});
