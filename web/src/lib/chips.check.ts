import assert from "node:assert";
import { breakDown, chipColor, columns } from "./chips";

// breakdown is exact for integer cents
for (const v of [0, 1, 4, 735, 2000, 123456, 999999]) {
  let sum = 0;
  for (const [denom, n] of breakDown(v)) sum += denom * n;
  assert.strictEqual(sum, v, `breakDown(${v}) = ${sum}`);
}

// greedy picks largest first
assert.deepStrictEqual([...breakDown(2000).keys()], [500]); // 2000¢ = 4 × 500¢
assert.deepStrictEqual(
  [...breakDown(735).entries()],
  [
    [500, 1],
    [100, 2],
    [25, 1],
    [5, 2],
  ],
);

// columns: 8 per column, capped count, largest denoms survive the cap
assert.strictEqual(columns(2000).length, 1); // 500¢ ×4 → one column
assert.strictEqual(columns(123456, 8, 4).length, 4); // capped
assert.deepStrictEqual(columns(123456, 8, 4).flat().slice(0, 9), Array(9).fill(10000));
assert.ok(columns(2000, 8, 4).every((col) => col.length <= 8));

// every denom has a color
for (const denom of [10000, 2500, 500, 100, 25, 5, 1]) {
  assert.notStrictEqual(chipColor(denom), "#8a8d94");
}

console.log("chips.check: all green");
