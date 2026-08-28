/**
 * Mirrored protocol types (server/internal/protocol/wire.go + engine events).
 * Keep in sync — server is the source of truth.
 */

export type Card = number // 0..51, rank = c >> 2 (0=2..12=A), suit = c & 3 (s h d c)

export const cardRank = (c: Card) => c >> 2
export const cardSuit = (c: Card) => c & 3

export type ActionKind = 'fold' | 'check' | 'call' | 'raise' | 'reveal' | 'muck' | 'rabbithunt'

export type LegalActions = {
  seat: number
  can_fold: boolean
  can_check: boolean
  can_call: boolean
  call_amount: number
  can_raise: boolean
  min_raise_to: number
  max_raise_to: number
}

export type SeatWire = {
  seat: number
  player?: string
  user_id?: string
  stack?: number
  in_hand?: boolean
  folded?: boolean
  all_in?: boolean
  sitting_out?: boolean
  is_button?: boolean
  last_action?: string
  street_bet?: number
}

export type TableState = {
  table_id: string
  name: string
  game_type: string
  config: {
    game_type: string
    small_blind: number
    big_blind: number
    max_seats: number
    action_timeout_s: number
  }
  seats: SeatWire[]
  your_seat: number
  hand_no: number
  street?: string
  board?: Card[][]
  pot?: number
  your_cards?: Card[]
  to_act_seat?: number
  deadline_unix_ms?: number
  legal_actions?: LegalActions
  hand_in_progress: boolean
}

/** Engine event (tagged union on `type`). Only the fields we render. */
export type GameEvent = {
  type: string
  hand_id?: number
  street?: string
  bomb_pot?: boolean
  seat?: number
  player?: string
  amount?: number
  to?: number
  cards?: Card[]
  board_index?: number
  pot?: number
  pot_index?: number
  to_act?: number
  deadline_unix_ms?: number
  action?: { seat: number; kind: ActionKind; amount?: number } | null
  winners?: { seat: number; amount: number; hand_name?: string; board_index?: number; pot_index?: number }[]
  hole_cards?: { seat: number; cards: Card[] }[]
  rabbit?: Card[]
  stacks?: { seat: number; player: string; stack: number }[]
  reason?: string
  uncontested?: boolean
}

export type ChatMsg = { seat: number; player: string; text: string }

export type PostHandPrompt = { seat: number; bounty: boolean; rabbit: boolean }

/** Client -> server message. */
export type ClientMsg =
  | { type: 'join'; seat: number; name?: string }
  | { type: 'leave' }
  | { type: 'action'; kind: 'fold' | 'check' | 'call' | 'bet'; amount?: number }
  | { type: 'chat'; text: string }
  | { type: 'rabbit'; reveal?: boolean }

/** Server -> client message (tagged union on `type`). */
export type ServerMsg =
  | { type: 'state'; state: TableState }
  | { type: 'event'; event: GameEvent }
  | { type: 'seats'; seats: SeatWire[] }
  | { type: 'chat'; chat: ChatMsg }
  | { type: 'action_required'; legal: LegalActions }
  | { type: 'post_hand'; post: PostHandPrompt }
  | { type: 'error'; error: string }
