export type GameType = "NLHE" | "PLO4";

export type BombPotMode = "off" | "every_hand" | "trigger";

/** A card rank+suit condition that arms the bomb pot for the next hand. */
export type BombPotTrigger = {
  rank: string; // 'A'..'K' or 'any'
  suit: string; // 's'|'h'|'d'|'c' or 'any'
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
