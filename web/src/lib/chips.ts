/**
 * Chip denominations for stack rendering. Server money stays int64 cents —
 * denominations are pure presentation, broken down greedily client-side.
 * Colors from the Notion design system (DESIGN.md), one hue per denom.
 */

export type ChipDenom = { cents: number; color: string };

const CHIPS: ChipDenom[] = [
  { cents: 10000, color: "#0075de" }, // notion blue
  { cents: 2500, color: "#02093a" }, // midnight
  { cents: 500, color: "#f64932" }, // coral
  { cents: 100, color: "#12805c" }, // success
  { cents: 25, color: "#ffb110" }, // marigold
  { cents: 5, color: "#62aef0" }, // sky
  { cents: 1, color: "#f6f5f4" }, // paper
];

export const chipColor = (cents: number) =>
  CHIPS.find((c) => c.cents === cents)?.color ?? "#8a8d94";

/**
 * Greedy breakdown: denom value -> chip count. Cents are integers, so the
 * breakdown is always exact (1¢ is the smallest chip).
 */
export function breakDown(cents: number): Map<number, number> {
  const out = new Map<number, number>();
  let left = Math.max(0, Math.round(cents));
  for (const c of CHIPS) {
    const n = Math.floor(left / c.cents);
    if (n > 0) {
      out.set(c.cents, n);
      left -= n * c.cents;
    }
  }
  return out;
}

/**
 * Render columns (largest denom first), ≤ perColumn chips each, ≤ maxColumns
 * columns — overflow drops the smallest chips (amount labels stay exact).
 */
export function columns(cents: number, perColumn = 8, maxColumns = 4): number[][] {
  const cols: number[][] = [];
  for (const [denom, n] of breakDown(cents)) {
    for (let i = 0; i < n; i += perColumn) {
      if (cols.length >= maxColumns) return cols;
      cols.push(Array.from({ length: Math.min(perColumn, n - i) }, () => denom));
    }
  }
  return cols;
}
