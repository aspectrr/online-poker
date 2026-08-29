import { Show } from 'solid-js'
import { money } from '../../lib/money'
import type { SeatState, TableState } from '../../lib/tableTypes'
import { CardRow } from '../cards/CardRow'
import { cn } from '../../lib/cn'

/** Countdown ring color shifts to danger under 5s. */
function ringColor(msLeft: number | null): string {
  if (msLeft == null) return 'var(--accent)'
  return msLeft < 5000 ? 'var(--danger)' : 'var(--accent)'
}

export function Seat(props: {
  seat: SeatState
  table: TableState
  /** ms left on this seat's clock, null when not acting */
  msLeft: number | null
  /** fraction of timeout remaining 0..1 */
  frac: number
  isHero: boolean
  class?: string
  style?: string
}) {
  const s = () => props.seat
  const acting = () => props.table.toAct === s().seat
  const empty = () => !s().player
  const holeCards = () =>
    props.isHero && props.table.holeCards[0]
      ? props.table.holeCards[0].map((c) => ({ ...c }))
      : null

  return (
    <div class={cn('absolute flex w-36 flex-col items-center gap-1.5 -translate-x-1/2 -translate-y-1/2', props.class)} style={props.style}>
      {/* cards sit above the nameplate */}
      <Show when={!empty()}>
        <div class="flex -space-x-4">
          <Show when={holeCards()} fallback={
            <Show when={s().hasCards}>
              <CardRow
                cards={[{ rank: 'A', suit: 's' }, { rank: 'A', suit: 's' }]}
                faceDownCount={2}
                size="sm"
                revealed={false}
                class="pointer-events-none opacity-95"
              />
            </Show>
          }>
            <CardRow cards={holeCards()!} size="sm" revealed />
          </Show>
        </div>
      </Show>

      <Show when={!empty()}>
        <div
          class={cn(
            'relative w-full rounded-xl border px-2.5 py-1.5 backdrop-blur-sm transition-shadow duration-300',
            'bg-surface/90 shadow-lg shadow-black/40',
            acting() ? 'border-accent/70' : 'border-line/80',
            s().folded && 'opacity-55 saturate-50',
            s().sittingOut && 'opacity-60',
            s().isWinner && 'border-success/80',
          )}
          classList={{
            'ring-2 ring-accent/60 shadow-[0_0_24px_rgba(212,175,55,0.35)] animate-[glow_1.6s_ease-in-out_infinite]': acting(),
          }}
        >
          {/* timer arc: svg circle around the nameplate */}
          <Show when={acting()}>
            <svg class="pointer-events-none absolute -inset-1.5" viewBox="0 0 100 54" preserveAspectRatio="none" aria-hidden="true">
              <rect x="1.5" y="1.5" width="97" height="51" rx="10" fill="none"
                stroke={ringColor(props.msLeft)} stroke-width="3" stroke-linecap="round"
                stroke-dasharray={`${props.frac * 280} 280`} />
            </svg>
          </Show>

          <div class="flex items-center justify-between gap-2">
            <span class={cn('truncate text-[13px] font-semibold', props.isHero ? 'text-accent' : 'text-fg')}>
              {props.isHero ? 'you' : s().player}
            </span>
            <Show when={props.table.buttonSeat === s().seat}>
              <span class="grid size-4 flex-none place-items-center rounded-full bg-white text-[9px] font-bold text-black shadow"
                title="Dealer button">D</span>
            </Show>
          </div>
          <div class="flex items-baseline justify-between gap-2">
            <span class="text-[13px] font-bold tabular-nums text-fg">{money(s().stackCents)}</span>
            <span class={cn(
              'h-4 truncate text-right text-[11px] font-medium',
              s().lastAction?.startsWith('Raise') || s().lastAction?.startsWith('Bet') ? 'text-accent' : 'text-fg-muted',
            )}>
              {s().lastAction}
            </span>
          </div>
        </div>

        {/* street bet chips + amount */}
        <Show when={s().betCents > 0}>
          <div class="flex items-center gap-1 rounded-full bg-black/30 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-fg">
            <span class="inline-block size-3 rounded-full border border-white/60 bg-danger shadow-inner" />
            {money(s().betCents)}
          </div>
        </Show>
      </Show>

      <Show when={empty()}>
        <div class="w-full rounded-xl border border-dashed border-line/70 bg-black/20 px-2.5 py-2.5 text-center text-[11px] text-fg-muted">
          empty seat
        </div>
      </Show>
    </div>
  )
}
