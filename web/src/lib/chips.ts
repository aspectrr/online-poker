/**
 * Chip denominations for stack rendering. Server money stays int64 cents —
 * denominations are pure presentation, broken down greedily client-side.
 * Casino-standard colors scaled to cents: 1/5/25/100/500/2500/10000.
 */

export type ChipDenom = { cents: number; color: string };

const CHIPS: ChipDenom[] = [
  { cents: 10000, color: "#2f6fdb" }, // blue
  { cents: 2500, color: "#e6b422" }, // yellow
  { cents: 500, color: "#7b4dbb" }, // purple
  { cents: 100, color: "#26282e" }, // black
  { cents: 25, color: "#2e9e5b" }, // green
  { cents: 5, color: "#d94141" }, // red
  { cents: 1, color: "#e8e6e3" }, // white
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
