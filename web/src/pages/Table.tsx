import { For, Show, createMemo, onMount } from 'solid-js'
import { useParams } from '@solidjs/router'
import { Button } from '../components/ui/Button'
import { provideTable } from '../stores/table'
import { MOCK_MODE } from '../lib/api'
import { money } from '../lib/money'
import { cardRank, cardSuit, type Card } from '../lib/protocol'

const RANKS = '23456789TJQKA'
const SUITS = 'shdc'
const cardStr = (c: Card) => `${RANKS[cardRank(c)]}${SUITS[cardSuit(c)]}`

/**
 * Table view: connects WS on mount, renders snapshot + increments.
 * Stub-level polish — seat ring + action bar, no fancy layout yet.
 */
export function TablePage() {
  const params = useParams()
  // ponytail: mock mode has no backend — render a hint instead of a dead WS
  const table = MOCK_MODE ? null : provideTable(params.id!)

  return (
    <div class="min-h-dvh felt-bg">
      <div class="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <Show when={table} fallback={<MockTableNotice />}>
          {(t) => <LiveTable table={t()} />}
        </Show>
      </div>
    </div>
  )
}

function MockTableNotice() {
  return (
    <div class="mt-16 grid place-items-center rounded-2xl border border-dashed border-line bg-surface/40 px-6 py-16 text-center">
      <p class="font-medium text-fg">Live table needs the backend</p>
      <p class="mt-1 text-sm text-fg-muted">Set VITE_API_URL + VITE_SUPABASE_* and sign in to play.</p>
    </div>
  )
}

function LiveTable(props: { table: ReturnType<typeof provideTable> }) {
  const t = props.table
  onMount(() => t.connect())

  const mySeat = () => t.state()?.your_seat ?? -1
  const seated = () => mySeat() >= 0
  const isMyTurn = () => t.toAct()?.seat === mySeat()

  return (
    <Show when={t.state()} fallback={<p class="mt-16 text-center text-fg-muted">{statusText(t.status())}…</p>}>
      {(st) => (
        <div class="space-y-6">
          <header class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 class="font-display text-xl font-bold text-fg">{st().name}</h1>
              <p class="text-sm text-fg-muted">
                {st().game_type} · {money(st().config.small_blind)}/{money(st().config.big_blind)} · hand #{st().hand_no}
                <Show when={st().hand_in_progress}> · {st().street || 'preflop'}</Show>
              </p>
            </div>
            <span class={cnStatus(t.status())}>{t.status()}</span>
          </header>

          <Show when={t.error()}>
            <p role="alert" class="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              {t.error()}
            </p>
          </Show>

          {/* pot + board */}
          <section class="rounded-2xl border border-line bg-surface/60 p-6 text-center">
            <p class="text-xs uppercase tracking-widest text-fg-muted">Pot</p>
            <p class="font-display text-3xl font-bold tabular-nums text-accent">{money(t.pot())}</p>
            <div class="mt-4 flex flex-wrap justify-center gap-2">
              <For each={t.board().flat()}>
                {(c) => <span class="rounded bg-white px-2 py-1 font-mono text-sm font-bold text-black">{cardStr(c)}</span>}
              </For>
              <Show when={!t.board().flat().length}>
                <span class="text-sm text-fg-muted">board deals with the hand</span>
              </Show>
            </div>
          </section>

          {/* seats */}
          <section class="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <For each={t.seats()}>
              {(s) => (
                <div class="rounded-xl border border-line bg-surface p-4">
                  <div class="flex items-center justify-between">
                    <span class="font-medium text-fg">{s.player || 'open'}</span>
                    <Show when={s.is_button}>
                      <span class="grid size-5 place-items-center rounded-full bg-accent text-[10px] font-bold text-bg">D</span>
                    </Show>
                  </div>
                  <p class="mt-1 text-sm tabular-nums text-fg-muted">{s.player ? money(s.stack ?? 0) : '—'}</p>
                  <Show when={s.last_action}>
                    <p class="mt-1 text-xs text-fg-muted">{s.last_action}</p>
                  </Show>
                </div>
              )}
            </For>
          </section>

          {/* my cards + actions */}
          <Show when={seated()}>
            <section class="rounded-2xl border border-accent/30 bg-surface p-4">
              <p class="text-xs uppercase tracking-widest text-fg-muted">Your hand</p>
              <div class="mt-1 flex gap-2">
                <For each={t.myCards()} fallback={<span class="text-sm text-fg-muted">waiting for cards</span>}>
                  {(c) => <span class="rounded bg-white px-3 py-1.5 font-mono text-lg font-bold text-black">{cardStr(c)}</span>}
                </For>
              </div>
              <Show when={isMyTurn()}>
                <div class="mt-4 flex flex-wrap gap-2">
                  <Button variant="danger" size="sm" onClick={() => t.act('fold')}>Fold</Button>
                  <Show when={t.toAct()?.can_check}>
                    <Button variant="outline" size="sm" onClick={() => t.act('check')}>Check</Button>
                  </Show>
                  <Show when={t.toAct()?.can_call}>
                    <Button size="sm" onClick={() => t.act('call')}>Call {money(t.toAct()!.call_amount)}</Button>
                  </Show>
                  <Show when={t.toAct()?.can_raise}>
                    <Button size="sm" onClick={() => t.act('bet', t.toAct()!.min_raise_to)}>
                      Raise to {money(t.toAct()!.min_raise_to)}
                    </Button>
                  </Show>
                </div>
              </Show>
              <Show when={t.postHand()?.seat === mySeat()}>
                <div class="mt-4 flex flex-wrap gap-2">
                  <Show when={t.postHand()?.bounty}>
                    <Button size="sm" onClick={() => t.decide(true)}>Reveal (7-2 bounty)</Button>
                    <Button variant="outline" size="sm" onClick={() => t.decide(false)}>Muck</Button>
                  </Show>
                  <Show when={t.postHand()?.rabbit}>
                    <Button variant="outline" size="sm" onClick={() => t.decide()}>Rabbit hunt</Button>
                  </Show>
                </div>
              </Show>
            </section>
          </Show>

          <SeatPicker show={!seated()} table={t} />

          {/* events log */}
          <section class="rounded-2xl border border-line bg-surface/60 p-4">
            <p class="text-xs uppercase tracking-widest text-fg-muted">Action</p>
            <ul class="mt-2 space-y-1 text-sm text-fg-muted">
              <For each={t.events().slice(-12).reverse()}>
                {(e) => <EventLine e={e} />}
              </For>
            </ul>
          </section>
        </div>
      )}
    </Show>
  )
}

function SeatPicker(props: { show: boolean; table: ReturnType<typeof provideTable> }) {
  const t = props.table
  const max = createMemo(() => t.state()?.config.max_seats ?? 9)
  return (
    <Show when={props.show}>
      <section class="rounded-2xl border border-dashed border-line bg-surface/40 p-4">
        <p class="text-sm font-medium text-fg">Take a seat</p>
        <div class="mt-3 flex flex-wrap gap-2">
          <For each={Array.from({ length: max() }, (_, i) => i)}>
            {(i) => (
              <Button variant="outline" size="sm" onClick={() => t.join(i)} disabled={!!t.seats()[i]?.player}>
                Seat {i + 1}
              </Button>
            )}
          </For>
        </div>
      </section>
    </Show>
  )
}

function EventLine(props: { e: import('../lib/protocol').GameEvent }) {
  const e = () => props.e
  const text = () => {
    switch (e().type) {
      case 'hand_started': return `Hand #${e().hand_id} starts${e().bomb_pot ? ' (bomb pot!)' : ''}`
      case 'blinds_posted': return `${e().player} posts ${money(e().amount ?? 0)}`
      case 'action_accepted': return `${e().player} ${e().action?.kind ?? ''}${e().amount != null ? ` ${money(e().amount ?? 0)}` : ''}`
      case 'street_dealt': return `${e().street}: ${(e().cards ?? []).map((c) => cardStr(c)).join(' ')}`
      case 'turn_changed': return `seat ${e().to_act} to act`
      case 'showdown': return 'showdown'
      case 'pot_awarded': return (e().winners ?? []).map((w) => `seat ${w.seat} wins ${money(w.amount)}${w.hand_name ? ` (${w.hand_name})` : ''}`).join(', ')
      case 'hand_ended': return 'hand ended'
      default: return e().type
    }
  }
  return <li class="tabular-nums">{text()}</li>
}

function statusText(s: string) {
  return s === 'open' ? 'connected' : s === 'connecting' ? 'connecting' : 'reconnecting'
}

function cnStatus(s: string) {
  const base = 'rounded-full px-2.5 py-0.5 text-xs font-medium ring-1'
  return s === 'open' ? `${base} bg-success/15 text-success ring-success/30` : `${base} bg-surface-raised text-fg-muted ring-line`
}
