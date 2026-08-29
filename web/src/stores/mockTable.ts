/**
 * Mock table store — standalone UI driver while ASPTR-181 (ws-backed
 * stores/table.ts) lands. Same TableStore interface. A hand is an explicit
 * timeline of steps; a cursor walks it with per-step delays. 'hero' steps
 * park the cursor until send() (or timeout auto-check). ponytail: scripted
 * theater, not an engine — the real store replaces this wholesale.
 */
import { createStore } from 'solid-js/store'
import type {
  LegalActions, PlayerAction, SeatState, Street, TableState, TableStore, UICard,
} from '../lib/tableTypes'

const SB = 10, BB = 20, HERO = 2, MAX = 6, START_STACK = 5000
const NAMES = ['mika', 'tomas', 'you', 'priya', 'leo', 'anna']
const HOLES: UICard[] = [{ rank: 'A', suit: 's' }, { rank: 'K', suit: 's' }]
const BOARD: UICard[] = [
  { rank: 'Q', suit: 's' }, { rank: 'J', suit: 's' }, { rank: '4', suit: 'd' },
  { rank: '10', suit: 's' }, { rank: '2', suit: 'c' },
]

type Step =
  | { t: 'msg'; text: string; delay?: number }
  | { t: 'post'; seat: number; cents: number; label: string }
  | { t: 'holes' }
  | { t: 'street'; street: Street; board: UICard[]; text: string }
  | { t: 'villain'; seat: number; kind: 'fold' | 'check' | 'call' | 'raise'; to?: number; label: string; think?: number }
  | { t: 'hero'; timeoutSec: number }
  | { t: 'award'; seat: number; text: string }
  | { t: 'end'; delay?: number }

/** One scripted hand. Buttons rotate; SB=btn+1, BB=btn+2, preflop first to act = BB+1. */
function scriptHand(button: number, handNo: number): Step[] {
  const sb = (button + 1) % MAX, bb = (button + 2) % MAX, utg = (button + 3) % MAX
  const mp = (button + 4) % MAX, co = (button + 5) % MAX
  const v = (seat: number, kind: Step extends never ? never : any, label: string, extra: Partial<Extract<Step, { t: 'villain' }>> = {}): Step =>
    ({ t: 'villain', seat, kind, label, ...extra } as Step)
  return [
    { t: 'msg', text: `Hand #${handNo} — new deal`, delay: 400 },
    { t: 'post', seat: sb, cents: SB, label: 'SB' },
    { t: 'post', seat: bb, cents: BB, label: 'BB' },
    { t: 'holes' },
    { t: 'msg', text: 'Hole cards dealt', delay: 700 },
    // preflop: utg folds, mp calls, hero acts, others react after
    v(utg, 'fold', 'Fold', { think: 1200 }),
    v(mp, 'call', 'Call $0.20', { think: 1500 }),
    { t: 'hero', timeoutSec: 20 },
    v(co, 'fold', 'Fold', { think: 1000 }),
    v(sb, 'fold', 'Fold', { think: 900 }),
    v(bb, 'check', 'Check', { think: 1200 }),
    { t: 'street', street: 'flop', board: BOARD.slice(0, 3), text: 'Flop: Q♠ J♠ 4♦' },
    v(bb, 'raise', 'Bet $0.45', { to: 45, think: 1600 }),
    v(mp, 'fold', 'Fold', { think: 1100 }),
    { t: 'hero', timeoutSec: 20 },
    { t: 'street', street: 'turn', board: BOARD.slice(0, 4), text: 'Turn: T♠' },
    v(bb, 'check', 'Check', { think: 1300 }),
    { t: 'hero', timeoutSec: 20 },
    { t: 'street', street: 'river', board: BOARD.slice(0, 5), text: 'River: 2♣' },
    v(bb, 'raise', 'Bet $1.10', { to: 110, think: 1800 }),
    { t: 'hero', timeoutSec: 20 },
    { t: 'award', seat: HERO, text: 'you win with ace-high flush' },
    { t: 'end', delay: 3400 },
  ]
}

function freshSeats(): SeatState[] {
  return NAMES.map((player, seat) => ({
    seat, player, stackCents: START_STACK, sittingOut: false,
    inHand: true, folded: false, betCents: 0, hasCards: true, lastAction: '',
  }))
}

const fmt = (c: number) => `$${(c / 100).toFixed(2)}`

export function createMockTable(tableId: string): TableStore {
  let timers: ReturnType<typeof setTimeout>[] = []
  const later = (fn: () => void, ms: number) => timers.push(setTimeout(fn, ms))
  const clearAll = () => { timers.forEach(clearTimeout); timers = [] }

  let handNo = 1
  let script: Step[] = []
  let cursor = 0
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null

  const [state, setState] = createStore<TableState>({
    tableId, name: 'Friday Night', gameType: 'NLHE',
    sbCents: SB, bbCents: BB,
    seats: freshSeats(), maxSeats: MAX,
    heroSeat: HERO, buttonSeat: 0,
    street: 'preflop', potCents: 0,
    board: { street: 'preflop', boards: [[]] },
    holeCards: [],
    toAct: -1, deadlineUnixMs: null, legal: null,
    handNo: 0, message: 'Taking your seat…',
    bombPot: false, isDoubleBoard: false,
  })
  const [err, setErr] = createStore({ lastError: null as string | null })

  const stack = (s: number) => state.seats[s].stackCents
  const bet = (s: number) => state.seats[s].betCents
  const streetBet = () => Math.max(0, ...state.seats.map((s) => s.betCents))
  const moveTo = (s: number, toCents: number, label: string) => {
    const delta = toCents - bet(s)
    setState('seats', s, 'betCents', toCents)
    setState('seats', s, 'stackCents', stack(s) - delta)
    if (label) setState('seats', s, 'lastAction', label)
  }
  const collect = () => {
    const total = state.seats.reduce((a, s) => a + s.betCents, 0)
    if (total) {
      setState('potCents', state.potCents + total)
      state.seats.forEach((_, i) => setState('seats', i, 'betCents', 0))
    }
  }
  const clearTurn = () => { setState('toAct', -1); setState('deadlineUnixMs', null); setState('legal', null) }

  function heroLegal(): LegalActions {
    const toCall = Math.max(0, streetBet() - bet(HERO))
    const maxTo = bet(HERO) + stack(HERO)
    const base = streetBet() === 0 ? BB : streetBet() * 2
    return {
      seat: HERO, canFold: true,
      canCheck: toCall === 0, canCall: toCall > 0,
      callCents: Math.min(toCall, stack(HERO)),
      canRaise: maxTo > Math.max(streetBet(), BB),
      minRaiseToCents: Math.min(base, maxTo),
      maxRaiseToCents: maxTo,
    }
  }

  function heroTurn(timeoutSec: number) {
    setState('toAct', HERO)
    setState('deadlineUnixMs', Date.now() + timeoutSec * 1000)
    setState('legal', heroLegal())
    timeoutTimer = setTimeout(() => {
      // timeout: auto check-or-fold
      const la = state.legal
      if (state.toAct === HERO && la) {
        send(la.canCheck ? { kind: 'check' } : { kind: 'fold' })
      }
    }, timeoutSec * 1000)
    timers.push(timeoutTimer)
  }

  function startHand() {
    clearAll()
    script = scriptHand((handNo - 1) % MAX, handNo)
    cursor = 0
    setState('handNo', handNo)
    setState('buttonSeat', (handNo - 1) % MAX)
    setState('street', 'preflop')
    setState('board', { street: 'preflop', boards: [[]] })
    setState('holeCards', [])
    setState('potCents', 0)
    setState('seats', freshSeats())
    advance(300)
  }

  function advance(delay: number) {
    later(step, delay)
  }

  function step() {
    const s = script[cursor]
    if (!s) return
    switch (s.t) {
      case 'msg':
        setState('message', s.text)
        cursor++; advance(s.delay ?? 600)
        break
      case 'post':
        moveTo(s.seat, s.cents, s.label)
        cursor++; advance(500)
        break
      case 'holes':
        setState('holeCards', [[...HOLES]])
        cursor++; advance(300)
        break
      case 'street':
        collect()
        setState('street', s.street)
        setState('board', { street: s.street, boards: [s.board] })
        setState('message', s.text)
        state.seats.forEach((_, i) => setState('seats', i, 'lastAction', ''))
        cursor++; advance(1000)
        break
      case 'villain': {
        if (s.kind === 'fold') {
          setState('seats', s.seat, 'folded', true)
          setState('seats', s.seat, 'hasCards', false)
        } else if (s.kind === 'raise') {
          moveTo(s.seat, Math.min(s.to!, bet(s.seat) + stack(s.seat)), s.label)
        } else if (s.kind === 'call') {
          moveTo(s.seat, bet(s.seat) + Math.min(streetBet() - bet(s.seat), stack(s.seat)), s.label)
        } else {
          setState('seats', s.seat, 'lastAction', s.label)
        }
        setState('toAct', s.seat)
        setState('deadlineUnixMs', Date.now() + (s.think ?? 1500) + 6000)
        setState('legal', null)
        later(() => { clearTurn(); cursor++; advance(250) }, s.think ?? 1500)
        break
      }
      case 'hero':
        heroTurn(s.timeoutSec)
        break // cursor parked until send()
      case 'award': {
        collect()
        const win = state.potCents
        setState('seats', s.seat, 'isWinner', true)
        setState('message', `${s.text} (+${fmt(win)})`)
        later(() => {
          setState('seats', s.seat, 'stackCents', stack(s.seat) + win)
          setState('seats', s.seat, 'isWinner', false)
          setState('potCents', 0)
          cursor++; advance(1)
        }, 2100)
        break
      }
      case 'end':
        handNo++
        setState('message', 'Shuffling…')
        later(startHand, s.delay ?? 3000)
        break
    }
  }

  function send(action: PlayerAction) {
    if (state.toAct !== HERO || !state.legal) {
      setErr('lastError', 'Not your turn')
      later(() => setErr('lastError', null), 2500)
      return
    }
    const la = state.legal
    if (action.kind === 'raise') {
      const to = Math.round(action.toCents)
      if (to < la.minRaiseToCents || to > la.maxRaiseToCents) {
        setErr('lastError', `Raise between ${fmt(la.minRaiseToCents)} and ${fmt(la.maxRaiseToCents)}`)
        later(() => setErr('lastError', null), 2500)
        return
      }
      moveTo(HERO, to, la.maxRaiseToCents === to ? 'All-in' : `Raise ${fmt(to)}`)
    } else if (action.kind === 'call') {
      const c = Math.min(la.callCents, stack(HERO))
      moveTo(HERO, bet(HERO) + c, c >= stack(HERO) ? 'All-in' : `Call ${fmt(c)}`)
    } else if (action.kind === 'check') {
      setState('seats', HERO, 'lastAction', 'Check')
    } else if (action.kind === 'fold') {
      setState('seats', HERO, 'folded', true)
      setState('seats', HERO, 'hasCards', false)
      setState('seats', HERO, 'lastAction', 'Fold')
    }
    clearTurn()
    cursor++
    advance(650)
  }

  later(startHand, 500)

  return {
    get state() { return state },
    get lastError() { return err.lastError },
    send,
    dispose: clearAll,
  }
}
