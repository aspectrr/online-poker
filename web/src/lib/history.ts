/**
 * Hand-history review model over the persisted hands.data jsonb (shape
 * written by server/internal/table/hands.go persistHand — see its doc
 * comment). The server returns dumb rows; all review derivation is
 * client-side here.
 */
import type { Card, GameEvent } from './protocol'
import { toUICard, type UICard } from './protocol'

export type StackWire = { seat: number; player: string; stack: number }

/** One row of GET /api/tables/:id/hands — store.Hand (Go field names). */
export type HandRow = {
  ID: number
  HandNo: number
  CreatedAt: string
  Data: {
    hand_no: number
    bomb_pot?: boolean
    button?: number
    start_stacks?: StackWire[]
    holes?: { seat: number; cards: Card[] }[]
    events: GameEvent[]
    stacks?: StackWire[]
  }
}

export type ActionLine = { player: string; text: string }
export type StreetLog = { street: string; lines: ActionLine[] }
export type BoardRow = { label?: string; streets: { street: string; cards: UICard[] }[] }
export type AwardLine = { player: string; amountCents: number; handName?: string; boardLabel?: string }

export type HandReview = {
  handNo: number
  bombPot: boolean
  /** dealt-in seats with starting stacks */
  seats: StackWire[]
  holes: { seat: number; player: string; cards: UICard[] }[]
  streets: StreetLog[]
  boardRows: BoardRow[]
  awards: AwardLine[]
  bounties: { player: string; amountCents: number }[]
  rabbit: UICard[]
}

/** List-row summary: total pot + aggregated winners, newest data only. */
export function handTotals(row: HandRow): { potCents: number; winners: { player: string; amountCents: number }[] } {
  const nameOf = namer(row)
  const potCents = new Map<number, number>()
  let potTotal = 0
  for (const ev of row.Data.events ?? []) {
    if (ev.type !== 'pot_awarded') continue
    for (const w of ev.winners ?? []) {
      potTotal += w.amount ?? 0
      potCents.set(w.seat, (potCents.get(w.seat) ?? 0) + (w.amount ?? 0))
    }
  }
  return {
    potCents: potTotal,
    winners: [...potCents].map(([seat, amountCents]) => ({ player: nameOf(seat), amountCents })),
  }
}

/** Build the full expanded review from a persisted hand row. */
export function reviewHand(row: HandRow): HandReview {
  const d = row.Data
  const nameOf = namer(row)
  const seats = d.start_stacks ?? []

  // per-street action log, event order grouped by street
  const byStreet = new Map<string, ActionLine[]>()
  let blindNo = 0
  for (const ev of d.events ?? []) {
    const lines = () => {
      let l = byStreet.get(ev.street ?? '')
      if (!l) {
        l = []
        byStreet.set(ev.street ?? '', l)
      }
      return l
    }
    switch (ev.type) {
      case 'blinds_posted':
        lines().push({ player: ev.player ?? '', text: `posts ${++blindNo <= 2 ? (blindNo === 1 ? 'SB' : 'BB') : 'blind'} ${cents(ev.amount)}` })
        break
      case 'antes_posted':
        lines().push({ player: ev.player ?? '', text: `antes ${cents(ev.amount)}` })
        break
      case 'action_accepted': {
        const k = ev.action?.kind
        const text =
          k === 'fold' ? 'folds'
          : k === 'check' ? 'checks'
          : k === 'call' ? `calls ${cents(ev.amount)}`
          : k === 'raise' ? `raises to ${cents(ev.to || ev.amount)}`
          : k ?? 'acts'
        lines().push({ player: ev.player ?? '', text })
        break
      }
      case 'all_in_runout':
        lines().push({ player: '', text: 'all-in — board run out' })
        break
    }
  }
  const streetOrder = ['preflop', 'flop', 'turn', 'river']
  const streets: StreetLog[] = [...byStreet].sort(
    (a, b) => streetOrder.indexOf(a[0]) - streetOrder.indexOf(b[0]),
  ).map(([street, lines]) => ({ street, lines }))

  // board rows keyed by board_index (0/1 for bomb pot + RIT)
  const boards = new Map<number, { street: string; cards: UICard[] }[]>()
  for (const ev of d.events ?? []) {
    if (ev.type !== 'street_dealt') continue
    let list = boards.get(ev.board_index ?? 0)
    if (!list) {
      list = []
      boards.set(ev.board_index ?? 0, list)
    }
    list.push({ street: ev.street ?? '', cards: (ev.cards ?? []).map(toUICard) })
  }
  const boardRows: BoardRow[] = [...boards].map(([idx, streets]) => ({
    label: boards.size > 1 ? (d.bomb_pot ? `Board ${idx === 0 ? 'A' : 'B'}` : `Run ${idx + 1}`) : undefined,
    streets,
  }))

  const awards: AwardLine[] = []
  const bounties: { player: string; amountCents: number }[] = []
  let rabbit: UICard[] = []
  for (const ev of d.events ?? []) {
    if (ev.type === 'pot_awarded') {
      for (const w of ev.winners ?? []) {
        const bi = w.board_index ?? 0
        awards.push({
          player: nameOf(w.seat),
          amountCents: w.amount ?? 0,
          handName: w.hand_name?.replace(/_/g, ' '),
          boardLabel: boards.size > 1 && (d.bomb_pot || bi > 0) ? (d.bomb_pot ? `board ${bi === 0 ? 'A' : 'B'}` : `run ${bi + 1}`) : undefined,
        })
      }
    } else if (ev.type === 'seven_deuce_bounty') {
      bounties.push({ player: ev.player ?? '', amountCents: ev.amount ?? 0 })
    } else if (ev.type === 'rabbit_hunt') {
      rabbit = (ev.rabbit ?? []).map(toUICard)
    }
  }

  return {
    handNo: d.hand_no,
    bombPot: !!d.bomb_pot,
    seats,
    holes: (d.holes ?? []).map((h) => ({ seat: h.seat, player: nameOf(h.seat), cards: (h.cards ?? []).map(toUICard) })),
    streets,
    boardRows,
    awards,
    bounties,
    rabbit,
  }
}

// ---- helpers ----

function namer(row: HandRow): (seat: number) => string {
  const names = new Map<number, string>()
  for (const s of [...(row.Data.start_stacks ?? []), ...(row.Data.stacks ?? [])]) {
    if (!names.has(s.seat)) names.set(s.seat, s.player)
  }
  return (seat) => names.get(seat) ?? `Seat ${seat}`
}

const cents = (n?: number) => `$${((n ?? 0) / 100).toFixed(2)}`
