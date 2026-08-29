import { For, Show } from 'solid-js'
import { money } from '../../lib/money'
import type { TableState } from '../../lib/tableTypes'
import { CardRow, dealDelay } from '../cards/CardRow'
import { cn } from '../../lib/cn'

/** Pot + board in the felt center. Double boards render two labeled rows. */
export function TableCenter(props: { table: TableState; dealKey: string }) {
  const t = () => props.table
  const boards = () => t().board.boards
  const isDouble = () => boards().length > 1
  const labels = () =>
    t().board.labels ?? boards().map((_, i) => (isDouble() ? String.fromCharCode(65 + i) : undefined))

  return (
    <div class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3">
      {/* pot */}
      <Show when={t().potCents > 0 || boards()[0].length > 0}>
        <div class="flex items-center gap-2 rounded-full border border-accent/25 bg-black/35 px-3.5 py-1 shadow-lg shadow-black/30 backdrop-blur-[2px]">
          <span class="flex -space-x-1.5" aria-hidden="true">
            <For each={[0, 1, 2]}>
              {() => <span class="inline-block size-4 rounded-full border border-white/50 bg-danger shadow-[inset_0_0_2px_rgba(0,0,0,0.4)]" />}
            </For>
          </span>
          <span class="text-sm font-bold tabular-nums text-accent">{money(t().potCents)}</span>
          <span class="text-[10px] font-semibold uppercase tracking-widest text-fg-muted">pot</span>
        </div>
      </Show>

      {/* board rows */}
      <For each={boards()}>
        {(cards, row) => (
          <div class="flex flex-col items-center gap-1">
            <Show when={isDouble()}>
              <span class="rounded bg-black/40 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-fg-muted">
                board {labels()[row()]}
              </span>
            </Show>
            <div class="flex gap-1.5">
              {/* 5 slots; empty ones dashed */}
              <For each={Array.from({ length: 5 })}>
                {(_, i) => {
                  const card = cards[i()]
                  return (
                    <Show
                      when={card}
                      fallback={
                        <div class={cn(
                          'h-20 w-14 rounded-lg border-2 border-dashed border-white/12 bg-black/15',
                          cards.length > 0 && i() === cards.length && 'border-white/20',
                        )} />
                      }
                    >
                      <div class="animate-deal" style={dealDelay(i(), 110)}>
                        <CardRow cards={[card!]} size="sm" revealed class="shadow-lg shadow-black/40" />
                      </div>
                    </Show>
                  )
                }}
              </For>
            </div>
          </div>
        )}
      </For>

      {/* status line */}
      <div class="mt-1 h-5 text-xs font-medium text-fg-muted">{t().message}</div>
    </div>
  )
}
