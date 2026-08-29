/**
 * Table client contract — shared by ASPTR-181 (ws store) and the table UI.
 * Mirrors server engine protocol (server/internal/engine/events.go):
 * events are the JSON wire shape verbatim; Card is the wire uint8
 * (rank = c >> 2 in 0..12 for 2..A, suit = c & 3 in s,h,d,c order).
 */

import type { Rank as CardRank, Suit as CardSuit } from '../components/cards/Card'

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete'

export type WireCard = number // 0..51 engine encoding

/** UI card spec, matching cards/Card components. */
export type UICard = { rank: CardRank; suit: CardSuit }

/** Decode wire card to UI card. */
export function toUICard(c: WireCard): UICard {
  const rank = '23456789TJQKA'[c >> 2].replace('T', '10') as UICard['rank']
  const suit = 'shdc'[c & 3] as UICard['suit']
  return { rank, suit }
}

export type SeatState = {
  seat: number
  player: string
  stackCents: number
  sittingOut: boolean
  inHand: boolean
  folded: boolean
  /** street-bet committed chips currently in front of the seat */
  betCents: number
  hasCards: boolean
  lastAction?: string // 'Raise $2.50', 'Call', 'Fold'…
  isWinner?: boolean
}

export type BoardState = {
  street: Street
  /** boards[row] — row 0 single board; rows A/B when double (bomb pot / RIT) */
  boards: UICard[][]
  labels?: string[]
}

export type LegalActions = {
  seat: number
  canFold: boolean
  canCheck: boolean
  canCall: boolean
  callCents: number
  canRaise: boolean
  minRaiseToCents: number
  maxRaiseToCents: number
}

export type TableState = {
  tableId: string
  name: string
  gameType: 'NLHE' | 'PLO4'
  sbCents: number
  bbCents: number
  seats: SeatState[] // fixed length, empty seats have empty player
  maxSeats: number
  heroSeat: number // -1 = spectator
  buttonSeat: number
  street: Street
  potCents: number // total in pot incl. street bets
  board: BoardState
  holeCards: UICard[][] // per hero only, rows for double-board games
  toAct: number // seat or -1
  deadlineUnixMs: number | null
  legal: LegalActions | null // non-null iff toAct === heroSeat
  handNo: number
  message: string // transient status line ("River: 4♦" …)
  bombPot: boolean
  isDoubleBoard: boolean
}

export type PlayerAction =
  | { kind: 'fold' }
  | { kind: 'check' }
  | { kind: 'call' }
  | { kind: 'raise'; toCents: number }
  | { kind: 'reveal' }
  | { kind: 'muck' }
  | { kind: 'rabbit' }

export type TableStore = {
  readonly state: TableState
  /** Send a player action from the hero seat. Errors surface via state.message. */
  send(action: PlayerAction): void
  /** Last error (rejected action etc.) — set, not thrown. */
  readonly lastError: string | null
  dispose(): void
}
