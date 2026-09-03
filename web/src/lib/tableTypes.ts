/**
 * ASPTR-199: the table client contract now lives in lib/protocol.ts
 * (single source of truth — wire types + this UI facade). Re-exported here
 * so component imports stay unchanged.
 */
export * from "./protocol";

/** your_hand wire category → display label (live label under hero cards). */
export const HAND_LABELS: Record<string, string> = {
  high_card: "High card",
  pair: "Pair",
  two_pair: "Two pair",
  trips: "Trips",
  straight: "Straight",
  flush: "Flush",
  full_house: "Full house",
  quads: "Quads",
  straight_flush: "Straight flush",
  royal_flush: "Royal flush",
};
