import { createSignal, onCleanup } from 'solid-js'
import { TableSocket, tableWsUrl } from '../lib/ws'
import { authIdentity } from '../lib/identity'
import {
  actionLabel, cardText, uiCards, uiLegal, uiSeat,
  type ConnectionStatus, type GameEvent, type LegalActionsWire, type PlayerAction,
  type SeatWire, type ServerMsg, type TableSnapshot, type TableState, type TableStore,
} from '../lib/protocol'
import { money } from '../lib/money'

const API_URL = import.meta.env.VITE_API_URL as string | undefined

const emptySeat = (seat: number): TableState['seats'][number] => ({
  seat, player: '', stackCents: 0, sittingOut: false, inHand: false, folded: false, betCents: 0, hasCards: false,
})

function initialState(tableId: string): TableState {
  return {
    tableId, name: 'table', gameType: 'NLHE', sbCents: 0, bbCents: 0,
    seats: Array.from({ length: 6 }, (_, i) => emptySeat(i)),
    maxSeats: 6, heroSeat: -1, buttonSeat: -1,
    street: 'preflop', potCents: 0,
    board: { street: 'preflop', boards: [[]] }, holeCards: [],
    toAct: -1, deadlineUnixMs: null, turnTimeoutMs: 20000, legal: null,
    handNo: 0, message: 'connecting…', bombPot: false, isDoubleBoard: false, postHand: null,
  }
}

/**
 * Live table store (ASPTR-199): ws -> TableStore facade. Joins the first
 * open seat on mount when we have an identity; spectator (heroSeat -1)
 * otherwise. Engine events fold into seats / board / pot / turn state.
 */
function createTableStore(tableId: string): TableStore {
  const [state, setState] = createSignal<TableState>(initialState(tableId))
  const [status, setStatus] = createSignal<ConnectionStatus>('connecting')
  const [lastError, setLastError] = createSignal<string | null>(null)
  const [toasts, setToasts] = createSignal<{ id: number; text: string }[]>([])

  let sock: TableSocket | null = null
  let name: string | null = null
  let joinSent = false // latch: don't re-join every snapshot
  let toastId = 0

  const patch = (p: Partial<TableState>) => setState((s) => ({ ...s, ...p }))

  const toast = (text: string) => {
    const id = ++toastId
    setToasts((ts) => [...ts, { id, text }])
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 4500)
  }

  const reduce = (m: ServerMsg) => {
    switch (m.type) {
      case 'state':
        applySnapshot(m.state)
        break
      case 'seats':
        setState((s) => ({ ...s, seats: m.seats.map(mergeSeatView(s)) }))
        break
      case 'event':
        applyEvent(m.event)
        break
      case 'action_required':
        setState((s) => {
          const hero = s.heroSeat >= 0 && m.legal.seat === s.heroSeat
          return {
            ...s,
            toAct: m.legal.seat,
            legal: hero ? uiLegal(m.legal as LegalActionsWire) : s.legal,
            postHand: hero ? null : s.postHand,
          }
        })
        break
      case 'post_hand':
        setState((s) => ({ ...s, postHand: m.post.seat === s.heroSeat ? { bounty: m.post.bounty, rabbit: m.post.rabbit } : null, toAct: -1, legal: null, deadlineUnixMs: null }))
        break
      case 'error':
        setLastError(m.error)
        setTimeout(() => setLastError((e) => (e === m.error ? null : e)), 4000)
        if (m.error.includes('seat taken')) joinSent = false // try the next open seat
        break
    }
  }

  /** Merge a wire seats frame into current view, preserving overlays. */
  const mergeSeatView = (s: TableState) => (w: SeatWire) => {
    const prev = s.seats.find((x) => x.seat === w.seat)
    return { ...uiSeat(w), revealedCards: prev?.revealedCards }
  }

  const applySnapshot = (snap: TableSnapshot) => {
    setState((s) => {
      const inHand = snap.hand_in_progress
      const legal = snap.legal_actions && snap.legal_actions.seat === snap.your_seat ? uiLegal(snap.legal_actions) : null
      return {
        ...s,
        name: snap.name,
        gameType: snap.config.game_type === 'PLO4' ? 'PLO4' : 'NLHE',
        sbCents: snap.config.small_blind,
        bbCents: snap.config.big_blind,
        maxSeats: Math.max(2, snap.config.max_seats),
        heroSeat: snap.your_seat,
        buttonSeat: snap.seats.find((x) => x.is_button)?.seat ?? -1,
        handNo: snap.hand_no,
        street: (snap.street as TableState['street']) ?? (inHand ? 'preflop' : s.street),
        potCents: snap.pot ?? 0,
        board: { ...s.board, boards: (snap.board?.length ? snap.board : [[]]).map(uiCards) },
        isDoubleBoard: (snap.board?.length ?? 1) > 1,
        holeCards: snap.your_cards?.length ? [uiCards(snap.your_cards)] : (inHand ? s.holeCards : []),
        toAct: snap.to_act_seat ?? -1,
        deadlineUnixMs: snap.deadline_unix_ms || null,
        turnTimeoutMs: Math.max(1000, (snap.config.action_timeout_s || 20) * 1000),
        legal,
        message: inHand ? s.message : 'Waiting for players…',
        // reconnect into a live hand keeps the bomb-pot banner; a fresh seat loses it
        bombPot: inHand ? s.bombPot : false,
        postHand: null,
        seats: snap.seats.map((w) => {
          const prev = s.seats.find((x) => x.seat === w.seat)
          return { ...uiSeat(w), revealedCards: inHand ? prev?.revealedCards : undefined }
        }),
      }
    })
    maybeAutoJoin()
  }

  const maybeAutoJoin = () => {
    const s = state()
    if (joinSent || !name || s.heroSeat >= 0) return
    const open = s.seats.find((x) => !x.player)?.seat
    if (open == null) return
    joinSent = true
    sock?.send({ type: 'join', seat: open, name })
  }

  const applyEvent = (e: GameEvent) => {
    // seat 0 / board 0 are omitted by Go's omitempty — coerce with ?? 0
    const seat = e.seat ?? 0
    const boardIdx = e.board_index ?? 0
    switch (e.type) {
      case 'hand_started':
        setState((s) => ({
          ...s,
          handNo: e.hand_id || s.handNo + 1,
          bombPot: e.bomb_pot ?? false,
          isDoubleBoard: e.bomb_pot ?? false,
          street: 'preflop', potCents: 0,
          board: { street: 'preflop', boards: [[]] },
          holeCards: [], toAct: -1, deadlineUnixMs: null, legal: null, postHand: null,
          message: e.bomb_pot ? 'Bomb pot — 4 cards, antes in' : `Hand #${e.hand_id || s.handNo + 1}`,
          seats: s.seats.map((x) => ({ ...x, folded: false, lastAction: undefined, isWinner: false, revealedCards: undefined })),
        }))
        break
      case 'holes_dealt':
        if (seat === state().heroSeat) {
          setState((s) => ({ ...s, holeCards: [uiCards(e.cards)] }))
        }
        break
      case 'blinds_posted':
      case 'antes_posted':
        // stacks/bets come from the seats frame that follows this batch;
        // just label the seat.
        setState((s) => ({
          ...s,
          seats: s.seats.map((x) => (x.seat === seat
            ? { ...x, lastAction: e.type === 'blinds_posted' ? actionLabel(e.amount === s.sbCents ? 'sb' : 'bb', 0) : 'Ante' }
            : x)),
        }))
        break
      case 'street_dealt':
        setState((s) => {
          const boards = s.board.boards.length ? [...s.board.boards] : [[]]
          while (boards.length <= boardIdx) boards.push([])
          const isFlop = e.street === 'flop'
          boards[boardIdx] = isFlop ? uiCards(e.cards) : [...boards[boardIdx], ...uiCards(e.cards)]
          const label = boards.length > 1 ? ` (board ${String.fromCharCode(65 + boardIdx)})` : ''
          return {
            ...s,
            street: e.street as TableState['street'],
            board: { ...s.board, boards },
            isDoubleBoard: boards.length > 1,
            potCents: e.pot ?? s.potCents,
            message: `${e.street}: ${cardText(e.cards)}${label}`,
            seats: s.seats.map((x) => ({ ...x, betCents: 0 })), // swept into the pot
          }
        })
        break
      case 'action_accepted':
        setState((s) => {
          const kind = e.action?.kind
          const label = kind === 'raise' && (e.to ?? 0) > 0
            ? `Raise to ${money(e.to!)}`
            : kind === 'call' && (e.amount ?? 0) > 0
              ? `Call ${money(e.amount!)}`
              : kind ? actionLabel(kind, 0) : ''
          return {
            ...s,
            // turn moved on: nobody is on the clock until the next turn_changed
            toAct: -1, deadlineUnixMs: null,
            legal: seat === s.heroSeat ? null : s.legal,
            seats: s.seats.map((x) => (x.seat === seat ? { ...x, lastAction: label, folded: kind === 'fold' || x.folded } : x)),
          }
        })
        break
      case 'turn_changed': {
        const dl = e.deadline_unix_ms || 0
        setState((s) => ({
          ...s,
          toAct: e.to_act ?? 0,
          deadlineUnixMs: dl || null,
          turnTimeoutMs: dl ? Math.min(120000, Math.max(1000, dl - Date.now())) : s.turnTimeoutMs,
          potCents: e.pot ?? s.potCents,
          legal: null, // action_required follows for the hero
        }))
        break
      }
      case 'all_in_runout':
        patch({ message: e.board_index === 1 ? 'All-in — running it twice' : 'All-in — running it out' })
        break
      case 'showdown':
        setState((s) => ({
          ...s,
          street: 'showdown',
          message: 'Showdown',
          potCents: e.pot ?? s.potCents,
          seats: s.seats.map((x) => {
            const reveal = e.hole_cards?.find((h) => h.seat === x.seat)
            return reveal ? { ...x, revealedCards: uiCards(reveal.cards) } : x
          }),
        }))
        break
      case 'pot_awarded':
        setState((s) => {
          const w = e.winners ?? []
          const first = w[0]
          const boardLabel = s.isDoubleBoard ? ` on board ${String.fromCharCode(65 + (first?.board_index ?? 0))}` : ''
          return {
            ...s,
            message: first
              ? `${s.seats[first.seat]?.player ?? 'seat ' + first.seat} wins ${money(w.reduce((a, x) => a + x.amount, 0))}${first.hand_name ? ` — ${first.hand_name}` : ''}${boardLabel}`
              : s.message,
            seats: s.seats.map((x) => (w.some((y) => y.seat === x.seat) ? { ...x, isWinner: true } : x)),
          }
        })
        break
      case 'seven_deuce_bounty':
        toast(`7-2 bounty! ${e.player ?? 'someone'} collects ${money(e.amount ?? 0)} from each player`)
        break
      case 'rabbit_hunt':
        setState((s) => {
          const boards = s.board.boards.length ? [...s.board.boards] : [[]]
          boards[0] = [...boards[0], ...uiCards(e.rabbit)]
          return { ...s, message: `Rabbit hunt: ${cardText(e.rabbit)}`, board: { ...s.board, boards } }
        })
        break
      case 'hand_ended':
        setState((s) => ({
          ...s,
          street: 'complete',
          toAct: -1, deadlineUnixMs: null, legal: null,
          seats: s.seats.map((x) => {
            const fs = e.stacks?.find((y) => y.seat === x.seat)
            return fs ? { ...x, stackCents: fs.stack, betCents: 0 } : { ...x, betCents: 0 }
          }),
        }))
        break
    }
  }

  const connect = async () => {
    if (!API_URL) {
      patch({ message: 'no API configured' })
      setStatus('closed')
      return
    }
    const id = await authIdentity()
    if (!id) {
      patch({ message: 'sign in to play (dev: add ?dev=you@example.com to the URL)' })
      setStatus('closed')
      return
    }
    name = id.name
    sock = new TableSocket(tableWsUrl(API_URL, tableId), id.token, reduce, setStatus)
    sock.connect()
  }

  const send = (a: PlayerAction) => {
    if (a.kind === 'raise') sock?.send({ type: 'action', kind: 'bet', amount: a.toCents })
    else if (a.kind === 'reveal') sock?.send({ type: 'rabbit', reveal: true })
    else if (a.kind === 'muck') sock?.send({ type: 'rabbit', reveal: false })
    else if (a.kind === 'rabbit') sock?.send({ type: 'rabbit' })
    else sock?.send({ type: 'action', kind: a.kind })
  }

  const joinSeat = (seat: number) => {
    if (!name) return
    joinSent = true
    sock?.send({ type: 'join', seat, name })
  }

  onCleanup(() => sock?.close())

  void connect() // fire-and-forget: resolves identity, opens the socket

  return {
    get state() { return state() },
    send,
    joinSeat,
    get status() { return status() },
    get lastError() { return lastError() },
    get toasts() { return toasts() },
    dispose: () => sock?.close(),
  }
}

export function provideTable(tableId: string): TableStore {
  return createTableStore(tableId)
}
