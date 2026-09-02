/**
 * Single source of truth for the table client protocol + the UI facade the
 * components consume (ASPTR-199). Mirrors server/internal/protocol/wire.go
 * and engine events (server/internal/engine/events.go) — server is truth;
 * keep names in sync.
 */

// ---- wire ----

export type Card = number; // 0..51, rank = c >> 2 (0=2..12=A), suit = c & 3 (s h d c)

export const cardRank = (c: Card) => c >> 2;
export const cardSuit = (c: Card) => c & 3;

export type ActionKind =
  | "fold"
  | "check"
  | "call"
  | "raise"
  | "reveal"
  | "muck"
  | "rabbithunt"
  | "stay"
  | "drop";

/** Engine LegalActions as sent on the wire (snake_case, cents). */
export type LegalActionsWire = {
  seat: number;
  can_fold: boolean;
  can_check: boolean;
  can_call: boolean;
  call_amount: number;
  can_raise: boolean;
  min_raise_to: number;
  max_raise_to: number;
};

export type SeatWire = {
  seat: number;
  player?: string;
  user_id?: string;
  stack?: number;
  in_hand?: boolean;
  folded?: boolean;
  all_in?: boolean;
  sitting_out?: boolean;
  is_button?: boolean;
  is_winner?: boolean;
  last_action?: string;
  street_bet?: number;
};

/** Full state snapshot (ServerMsg `state`). */
export type TableSnapshot = {
  table_id: string;
  name: string;
  game_type: string;
  config: {
    game_type: string;
    small_blind: number;
    big_blind: number;
    max_seats: number;
    action_timeout_s: number;
    inter_hand_delay_s?: number;
    rit?: string;
    rabbit_hunt?: boolean;
    seven_deuce?: boolean;
    seven_deuce_bounty?: number;
    bomb_pot_mode?: string;
    bomb_pot_triggers?: TriggerWire[];
    texas_drop_ante?: number;
  };
  seats: SeatWire[];
  your_seat: number;
  hand_no: number;
  street?: string;
  board?: Card[][];
  pot?: number;
  your_cards?: Card[];
  to_act_seat?: number;
  deadline_unix_ms?: number;
  rebuys_used?: number;
  top_up_queued?: boolean;
  legal_actions?: LegalActionsWire;
  hand_in_progress: boolean;
  bomb_pot_next?: boolean;
  bomb_pot?: boolean;
  texas_drop_next?: boolean;
  texas_drop?: boolean;
  drop_round?: number;
  drop_waiting?: number;
  drop_decided?: boolean;
};

/** Bomb-pot trigger for display (server ranks 2-14, suit 0-3). */
export type TriggerWire = { rank?: number; suit?: number; color?: string };

/** Engine event (tagged union on `type`). Only the fields we render. */
export type GameEvent = {
  type: string;
  hand_id?: number;
  street?: string;
  bomb_pot?: boolean;
  texas_drop?: boolean;
  seat?: number;
  player?: string;
  amount?: number;
  to?: number;
  cards?: Card[];
  board_index?: number;
  pot?: number;
  pot_index?: number;
  to_act?: number;
  deadline_unix_ms?: number;
  action?: { seat: number; kind: ActionKind; amount?: number } | null;
  winners?: {
    seat: number;
    amount: number;
    hand_name?: string;
    board_index?: number;
    pot_index?: number;
  }[];
  hole_cards?: { seat: number; cards: Card[] }[];
  button_seat?: number; // hand_started: dealer button seat this hand
  rabbit?: Card[];
  stacks?: { seat: number; player: string; stack: number }[];
  reason?: string;
  uncontested?: boolean;
  round?: number; // texas drop: round no.
  waiting?: number; // drop_decide: seats yet to choose
  stay?: boolean; // drop_decided ack
  decisions?: { seat: number; stay: boolean }[]; // drop_reveal
  equities?: { seat: number; pct: number }[]; // all_in_runout: win %
};

export type ChatMsg = { seat: number; player: string; text: string };

export type PostHandPrompt = { seat: number; bounty: boolean; rabbit: boolean; reveal: boolean };

/** Client -> server message. */
export type ClientMsg =
  | { type: "join"; seat: number; name?: string; stack?: number }
  | { type: "leave" }
  | { type: "action"; kind: "fold" | "check" | "call" | "bet" | "stay" | "drop"; amount?: number }
  | { type: "chat"; text: string }
  | { type: "rabbit"; reveal?: boolean }
  | { type: "bomb_pot" }
  | { type: "texas_drop" }
  | { type: "dev_deal"; seat: number; cards: Card[] }
  | { type: "top_up" };

/** Server -> client message (tagged union on `type`). */
export type ServerMsg =
  | { type: "state"; state: TableSnapshot }
  | { type: "event"; event: GameEvent }
  | { type: "seats"; seats: SeatWire[] }
  | { type: "chat"; chat: ChatMsg }
  | { type: "action_required"; legal: LegalActionsWire }
  | { type: "post_hand"; post: PostHandPrompt }
  | { type: "error"; error: string };

// ---- UI facade (consumed by components; camelCase, cents) ----

import type { Rank as CardRank, Suit as CardSuit } from "../components/cards/Card";

export type Street = "preflop" | "flop" | "turn" | "river" | "showdown" | "drop" | "complete";

export type WireCard = number; // 0..51 engine encoding

/** UI card spec, matching cards/Card components. */
export type UICard = { rank: CardRank; suit: CardSuit };

/** Board card spec — adds rabbit-hunt styling flag to plain cards. */
export type BoardCard = UICard & { rabbit?: boolean };

/** Decode wire card to UI card. */
export function toUICard(c: WireCard): UICard {
  const rank = "23456789TJQKA"[c >> 2].replace("T", "10") as UICard["rank"];
  const suit = "shdc"[c & 3] as UICard["suit"];
  return { rank, suit };
}

/** Suit glyphs for status text. */
export const SUIT_CHAR: Record<UICard["suit"], string> = { s: "♠", h: "♥", d: "♦", c: "♣" };

export const uiCards = (cs: Card[] | undefined): UICard[] => (cs ?? []).map(toUICard);

/** `Flop: Q♠ J♠ 4♦`-style text from wire cards. */
export const cardText = (cs: Card[] | undefined): string =>
  uiCards(cs)
    .map((c) => c.rank + SUIT_CHAR[c.suit])
    .join(" ");

export type SeatState = {
  seat: number;
  player: string;
  stackCents: number;
  sittingOut: boolean;
  inHand: boolean;
  folded: boolean;
  /** street-bet committed chips currently in front of the seat */
  betCents: number;
  hasCards: boolean;
  lastAction?: string; // 'Raise $2.50', 'Call', 'Fold'…
  isWinner?: boolean;
  /** hole cards revealed at showdown (villains included) */
  revealedCards?: UICard[];
};

export type BoardState = {
  street: Street;
  /** boards[row] — row 0 single board; rows A/B when double (bomb pot / RIT) */
  boards: BoardCard[][];
  labels?: string[];
};

export type LegalActions = {
  seat: number;
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  callCents: number;
  canRaise: boolean;
  minRaiseToCents: number;
  maxRaiseToCents: number;
};

/** Wire LegalActions -> UI LegalActions. */
export const uiLegal = (la: LegalActionsWire): LegalActions => ({
  seat: la.seat,
  canFold: la.can_fold,
  canCheck: la.can_check,
  canCall: la.can_call,
  callCents: la.call_amount,
  canRaise: la.can_raise,
  minRaiseToCents: la.min_raise_to,
  maxRaiseToCents: la.max_raise_to,
});

export const uiSeat = (s: SeatWire): SeatState => ({
  seat: s.seat,
  player: s.player ?? "",
  stackCents: s.stack ?? 0,
  sittingOut: s.sitting_out ?? false,
  inHand: s.in_hand ?? false,
  folded: s.folded ?? false,
  betCents: s.street_bet ?? 0,
  hasCards: s.in_hand ?? false,
  lastAction: s.last_action ? actionLabel(s.last_action, s.street_bet ?? 0) : undefined,
  isWinner: s.is_winner ?? false,
});

/** Human label for a server last_action kind; amounts come with raise/call. */
export function actionLabel(kind: string, streetBet: number): string {
  switch (kind) {
    case "fold":
      return "Fold";
    case "check":
      return "Check";
    case "call":
      return "Call";
    case "stay":
      return "Stay";
    case "drop":
      return "Drop";
    case "raise":
      return streetBet > 0 ? `Raise to ${(streetBet / 100).toFixed(2)}` : "Raise";
    case "sb":
      return "SB";
    case "bb":
      return "BB";
    case "ante":
      return "Ante";
    default:
      return kind;
  }
}

export type TableState = {
  tableId: string;
  name: string;
  gameType: "NLHE" | "PLO4";
  sbCents: number;
  bbCents: number;
  seats: SeatState[]; // fixed length, empty seats have empty player
  maxSeats: number;
  heroSeat: number; // -1 = spectator
  buttonSeat: number;
  /** seat the "first to act" pulse lands on after the opening deal */
  landingSeat: number;
  street: Street;
  potCents: number; // total in pot incl. street bets
  board: BoardState;
  holeCards: UICard[][]; // per hero only, rows for double-board games
  toAct: number; // seat or -1
  deadlineUnixMs: number | null;
  rebuysUsed: number;
  topUpQueued: boolean;
  /** total turn-clock duration the current deadline was set from (arc math) */
  turnTimeoutMs: number;
  legal: LegalActions | null; // non-null iff toAct === heroSeat
  handNo: number;
  message: string; // transient status line ("River: 4♦" …)
  bombPot: boolean;
  isDoubleBoard: boolean;
  /** Texas Drop live: current hand is a drop game */
  texasDrop: boolean;
  /** Texas Drop decision phase state (null outside it) */
  dropPhase: { round: number; waiting: number; heroDecided: boolean; heroEligible: boolean } | null;
  /** armed for the NEXT hand (texas_drop_armed) */
  texasDropArmed: boolean;
  /** 7-2 reveal/muck + rabbit prompt for the hero, when offered */
  postHand: { bounty: boolean; rabbit: boolean; reveal: boolean } | null;
  /** read-only active config for the settings drawer */
  cfg: TableConfigView;
  /** armed for the NEXT hand (bomb_pot_armed); UICard = trigger card when trigger-driven, true = manual arm */
  bombPotArmed: UICard | true | null;
  /** board rows that had a pot awarded to them (per-board win highlight) */
  boardWins: number[];
  /** all-in win % per seat while a runout is in progress */
  equities: Record<number, number> | null;
  /** per-board winner lines while a double-board hand resolves */
  boardWinTexts: (string | undefined)[];
  /** transient felt banner kind ("drop"|"drop_armed"|"bomb"|"bomb_armed"), auto-clears after 5s */
  banner: string | null;
  /** opening deal sequence: cards landed per seat / cards per player */
  dealt: number[];
  dealTotal: number;
  /** true after the last deal-sequence card landed (final hero flip) */
  dealDone: boolean;
};

/** Read-only config view for the settings drawer. */
export type TableConfigView = {
  actionTimeoutS: number;
  interHandDelayS: number;
  rit: string;
  rabbitHunt: boolean;
  sevenDeuce: boolean;
  sevenDeuceBounty: number;
  bombPotMode: string;
  bombPotTriggers: TriggerWire[];
  texasDropAnte: number;
};

export type PlayerAction =
  | { kind: "fold" }
  | { kind: "check" }
  | { kind: "call" }
  | { kind: "raise"; toCents: number }
  | { kind: "reveal" }
  | { kind: "muck" }
  | { kind: "rabbit" }
  | { kind: "stay" }
  | { kind: "drop" };

export type ConnectionStatus = "connecting" | "open" | "closed";

export type TableStore = {
  readonly state: TableState;
  /** Send a player action from the hero seat. Errors surface via lastError. */
  send(action: PlayerAction): void;
  /** Take a seat (ws join). Name required for guests; stack in cents. */
  joinSeat(seat: number, name?: string, stackCents?: number): void;
  /** Identity of this connection (display name + guest flag), once resolved. */
  readonly me: { name: string; isGuest: boolean } | null;
  /** Arm a bomb pot for the next hand (manual mode). */
  armBombPot(): void;
  /** Arm a Texas Drop game for the next hand. */
  armTexasDrop(): void;
  /** Queue a 100bb top-up; credits at the next hand start (max 3/session). */
  topUp(): void;
  /** Force hero hole cards next hand (dev builds only). Wire card numbers. */
  devDeal(cards: WireCard[]): void;
  /** Current ws connection state. */
  readonly status: ConnectionStatus;
  /** Last error (rejected action etc.) — set, not thrown. */
  readonly lastError: string | null;
  /** Transient toasts (7-2 bounty, bomb pot, …). */
  readonly toasts: { id: number; text: string; kind?: "gold" | "rabbit" }[];
  dispose(): void;
};
