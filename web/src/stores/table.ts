import { createSignal, onCleanup } from 'solid-js'
import { TableSocket, tableWsUrl } from '../lib/ws'
import { supabase } from '../lib/supabase'
import type { Card, ChatMsg, GameEvent, LegalActions, PostHandPrompt, SeatWire, ServerMsg, TableState } from '../lib/protocol'

const API_URL = import.meta.env.VITE_API_URL as string | undefined

/**
 * Table store: state snapshot + event-sourced increments. Solid signals all
 * the way down; ws events reduce into signals.
 */
function createTableStore(tableId: string) {
  const [state, setState] = createSignal<TableState | null>(null)
  const [seats, setSeats] = createSignal<SeatWire[]>([])
  const [board, setBoard] = createSignal<Card[][]>([])
  const [pot, setPot] = createSignal(0)
  const [myCards, setMyCards] = createSignal<Card[]>([])
  const [toAct, setToAct] = createSignal<LegalActions | null>(null)
  const [deadline, setDeadline] = createSignal(0)
  const [postHand, setPostHand] = createSignal<PostHandPrompt | null>(null)
  const [chat, setChat] = createSignal<ChatMsg[]>([])
  const [events, setEvents] = createSignal<GameEvent[]>([])
  const [status, setStatus] = createSignal<'connecting' | 'open' | 'closed'>('connecting')
  const [error, setError] = createSignal('')

  let sock: TableSocket | null = null

  const reduce = (m: ServerMsg) => {
    switch (m.type) {
      case 'state':
        setState(m.state)
        setSeats(m.state.seats)
        setBoard(m.state.board ?? [])
        setPot(m.state.pot ?? 0)
        setMyCards(m.state.your_cards ?? [])
        setToAct(m.state.legal_actions ?? null)
        setDeadline(m.state.deadline_unix_ms ?? 0)
        break
      case 'seats':
        setSeats(m.seats)
        break
      case 'event':
        applyEvent(m.event)
        break
      case 'action_required':
        setToAct(m.legal)
        break
      case 'post_hand':
        setPostHand(m.post)
        break
      case 'chat':
        setChat((c) => [...c.slice(-99), m.chat])
        break
      case 'error':
        setError(m.error)
        window.setTimeout(() => setError(''), 4000)
        break
    }
  }

  const applyEvent = (e: GameEvent) => {
    setEvents((xs) => [...xs.slice(-199), e])
    switch (e.type) {
      case 'holes_dealt':
        // private: server sends it only to the owning seat
        if (e.seat === state()?.your_seat) setMyCards(e.cards ?? [])
        break
      case 'street_dealt': {
        const bi = e.board_index ?? 0
        const cards = e.cards ?? []
        setBoard((b) => {
          const nb = b.length ? [...b] : [[]]
          while (nb.length <= bi) nb.push([])
          if (e.street === 'flop') nb[bi] = cards
          else nb[bi] = [...nb[bi], ...cards]
          return nb
        })
        break
      }
      case 'turn_changed':
        setPot(e.pot ?? 0)
        setToAct(null) // wait for own action_required
        setDeadline(e.deadline_unix_ms ?? 0)
        break
      case 'action_accepted':
        if (e.seat === state()?.your_seat) setToAct(null)
        setPot(e.pot ?? pot())
        // update seat lastAction view
        setSeats((ss) => ss.map((s) => (s.seat === e.seat ? { ...s, last_action: e.action?.kind ?? '' } : s)))
        break
      case 'pot_awarded':
        for (const w of e.winners ?? []) {
          setSeats((ss) => ss.map((s) => (s.seat === w.seat ? { ...s, stack: (s.stack ?? 0) + w.amount } : s)))
        }
        break
      case 'hand_started':
        setBoard([])
        setPot(0)
        setMyCards([])
        setToAct(null)
        setPostHand(null)
        break
      case 'hand_ended':
        for (const fs of e.stacks ?? []) {
          setSeats((ss) => ss.map((s) => (s.seat === fs.seat ? { ...s, stack: fs.stack, in_hand: false } : s)))
        }
        setBoard((b) => b) // board stays visible until next hand
        setToAct(null)
        setPostHand(null)
        break
      case 'showdown':
      case 'rabbit_hunt':
        break // rendered from events log
    }
  }

  const connect = async () => {
    if (!API_URL) {
      setError('no API configured')
      return
    }
    const sb = supabase()
    if (!sb) {
      setError('sign in first')
      return
    }
    const { data } = await sb.auth.getSession()
    const token = data.session?.access_token
    if (!token) {
      setError('sign in first')
      return
    }
    sock = new TableSocket(tableWsUrl(API_URL, tableId), token, reduce, setStatus)
    sock.connect()
  }

  const send = (m: Parameters<TableSocket['send']>[0]) => sock?.send(m)
  const join = (seat: number) => send({ type: 'join', seat })
  const act = (kind: 'fold' | 'check' | 'call' | 'bet', amount?: number) => send({ type: 'action', kind, amount })
  const say = (text: string) => send({ type: 'chat', text })
  const decide = (reveal?: boolean) => send({ type: 'rabbit', reveal })

  onCleanup(() => sock?.close())

  return {
    state, seats, board, pot, myCards, toAct, deadline, postHand, chat, events, status, error,
    connect, join, act, say, decide,
  }
}

type TableStore = ReturnType<typeof createTableStore>

export function provideTable(tableId: string): TableStore {
  const store = createTableStore(tableId)
  void store.connect()
  return store
}
