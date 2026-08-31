/**
 * Raise preset math — raise-TO semantics, cents only.
 * Pure functions; consumed by ActionBar.
 */
import type { Street } from "./tableTypes";

export type PresetCtx = {
  street: Street;
  potCents: number; // total pot incl. street bets
  streetBetCents: number; // current highest bet on street
  heroBetCents: number;
  callCents: number; // for hero (already min'd with stack)
  sbCents: number;
  bbCents: number;
  minRaiseToCents: number;
  maxRaiseToCents: number;
};

export type Preset = { label: string; toCents: number };

/** Raise-TO presets per situation. Out-of-range presets are dropped. */
export function raisePresets(ctx: PresetCtx): Preset[] {
  const { minRaiseToCents: lo, maxRaiseToCents: hi } = ctx;
  const fits = (to: number, label: string): Preset | null =>
    to >= lo && to < hi ? { label, toCents: Math.round(to) } : null;

  if (ctx.street === "preflop") {
    if (ctx.streetBetCents <= ctx.bbCents) {
      // unopened: 2.5x / 3.5x bb (total)
      return [
        fits(ctx.bbCents * 2.5, "2.5bb"),
        fits(ctx.bbCents * 3.5, "3.5bb"),
        { label: "All-in", toCents: hi },
      ].filter(Boolean) as Preset[];
    }
    // vs a raise: 3x their raise-to total
    return [fits(ctx.streetBetCents * 3, "3x"), { label: "All-in", toCents: hi }].filter(
      Boolean,
    ) as Preset[];
  }

  // postflop: % of pot (pot after hero's call)
  const potAfterCall = ctx.potCents + ctx.callCents;
  const base = ctx.heroBetCents + ctx.callCents;
  return [
    fits(base + potAfterCall * 0.33, "33%"),
    fits(base + potAfterCall * 0.5, "50%"),
    fits(base + potAfterCall * 0.75, "75%"),
    fits(base + potAfterCall * 1.0, "100%"),
    { label: "All-in", toCents: hi },
  ].filter(Boolean) as Preset[];
}

/** Arrow-key/slider step: bb preflop, 10% pot postflop. */
export function raiseStepCents(ctx: PresetCtx): number {
  if (ctx.street === "preflop") return ctx.bbCents;
  return Math.max(ctx.sbCents, Math.round((ctx.potCents + ctx.callCents) * 0.1));
}

/** Parse a typed bet string ("$2.50", "2.5", "250") → cents, or null. */
export function parseBetToCents(input: string): number | null {
  const t = input.replace(/[$,\s]/g, "");
  if (!/^\d*(\.\d{0,2})?$/.test(t) || t === "" || t === ".") return null;
  return Math.round(parseFloat(t) * 100);
}
