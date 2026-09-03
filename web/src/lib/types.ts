export type GameType = "NLHE" | "PLO4";

export type BombPotMode = "off" | "every_hand" | "trigger";

/** A bomb-pot condition: rank plus one or more suits (empty = any suit). */
export type BombPotTrigger = {
  rank: string; // 'A'..'2'
  suits: string[]; // subset of 'shdc'; [] = any suit
};

export type TableConfig = {
  name: string;
  gameType: GameType;
  smallBlindCents: number;
  bigBlindCents: number;
  startingStackBb: number;
  actionTimeoutSec: number;
  interHandDelaySec: number;
  runItTwice: "off" | "always" | "when_agreed";
  rabbitHunt: boolean;
  bombPotMode: BombPotMode;
  bombPotTrigger?: BombPotTrigger;
  sevenTwo: boolean;
  sevenTwoBountyCents: number;
};

export type TableSummary = {
  id: string;
  name: string;
  gameType: GameType;
  smallBlindCents: number;
  bigBlindCents: number;
  seatsFilled: number;
  maxSeats: number;
  avgPotCents?: number;
  playersToActFlopPct?: number;
  /** creator's auth uid (server) — enables the delete affordance */
  createdBy?: string | null;
};

export const DEFAULT_TABLE_CONFIG: TableConfig = {
  name: "",
  gameType: "NLHE",
  smallBlindCents: 10,
  bigBlindCents: 20,
  startingStackBb: 100,
  actionTimeoutSec: 15,
  interHandDelaySec: 5,
  runItTwice: "off",
  rabbitHunt: false,
  bombPotMode: "off",
  bombPotTrigger: undefined,
  sevenTwo: false,
  sevenTwoBountyCents: 0,
};
