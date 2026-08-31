import { createEffect, createSignal, For, Show } from 'solid-js'
import { fetchHands } from '../../lib/api'
import { handTotals, reviewHand, type HandRow, type HandReview } from '../../lib/history'
import { money } from '../../lib/money'
import { Card } from '../cards/Card'

/**
 * Hand-history slide-over: finished hands for this table, newest first.
 * Rows show hand no / pot / winner(s) / time; expanding one renders the
 * full review (seats, all hole cards, per-street action, boards, awards).
 */
export function HistoryDrawer(props: { open: boolean; tableId: string; onClose: () => void }) {
  const [rows, setRows] = createSignal<HandRow[] | null>(null) // null = loading
  const [error, setError] = createSignal<string | null>(null)
  const [expanded, setExpanded] = createSignal<number | null>(null)

  createEffect(() => {
    if (!props.open) return
    setRows(null)
    setError(null)
    setExpanded(null)
    fetchHands(props.tableId).then(setRows).catch((e: Error) => setError(e.message))
  })

  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Hand history">
        {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer shortcut only; close button and Escape path live in the drawer */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: see above */}
        <div class="absolute inset-0 bg-black/40" onClick={props.onClose} />
        <div class="absolute inset-y-0 right-0 flex w-96 max-w-[92vw] flex-col border-l border-line bg-surface shadow-2xl animate-in-left">
          <div class="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 class="font-display text-sm font-bold">Hand history</h2>
            <button
              type="button"
              class="rounded-lg px-2 py-1 text-sm text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg"
              onClick={props.onClose}
            >
              close
            </button>
          </div>

          <div class="flex-1 overflow-y-auto px-3 py-3">
            <Show when={!error()} fallback={
              <EmptyState title="History unavailable">
                {error()?.includes('503')
                  ? 'This server has no database — hands aren\u2019t being stored.'
                  : error()?.split(':').pop()}
              </EmptyState>
            }>
              <Show when={rows()} fallback={<div class="py-10 text-center text-sm text-fg-muted">loading…</div>}>
                <Show when={(rows() ?? []).length > 0} fallback={
                  <EmptyState title="No hands yet">
                    Finished hands land here — play one and it shows up.
                  </EmptyState>
                }>
                  <div class="flex flex-col gap-1.5">
                    <For each={rows()}>
                      {(row) => (
                        <HandRowItem
                          row={row}
                          expanded={expanded() === row.ID}
                          onToggle={() => setExpanded(expanded() === row.ID ? null : row.ID)}
                        />
                      )}
                    </For>
                  </div>
                </Show>
              </Show>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  )
}

function HandRowItem(props: { row: HandRow; expanded: boolean; onToggle: () => void }) {
  const totals = () => handTotals(props.row)
  const time = () =>
    new Date(props.row.CreatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return (
    <div class="overflow-hidden rounded-xl border border-line bg-surface-raised/40">
      <button
        type="button"
        class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-raised/70"
        onClick={props.onToggle}
        aria-expanded={props.expanded}
      >
        <span class="flex items-baseline gap-2">
          <span class="font-display text-sm font-bold">#{props.row.HandNo}</span>
          <span class="text-xs tabular-nums text-fg-muted">{money(totals().potCents)}</span>
        </span>
        <span class="flex items-baseline gap-2 text-xs">
          <span class="truncate font-semibold text-accent">
            {totals().winners.map((w) => w.player).join(' + ') || '—'}
          </span>
          <span class="tabular-nums text-fg-muted">{time()}</span>
          <span class="text-fg-muted">{props.expanded ? '▾' : '▸'}</span>
        </span>
      </button>
      <Show when={props.expanded}>
        <HandReviewPanel review={reviewHand(props.row)} />
      </Show>
    </div>
  )
}

function HandReviewPanel(props: { review: HandReview }) {
  const r = () => props.review
  return (
    <div class="flex flex-col gap-3 border-t border-line px-3 py-3">
      {/* hole cards — all revealed in history */}
      <section>
        <SectionTitle>{r().bombPot ? 'Hole cards (bomb pot — 4 each)' : 'Hole cards'}</SectionTitle>
        <div class="flex flex-col gap-1.5">
          <For each={r().holes}>
            {(h) => (
              <div>
                <div class="flex items-baseline justify-between gap-2">
                  <span class="truncate text-xs font-semibold">{h.player}</span>
                  <span class="text-[11px] tabular-nums text-fg-muted">
                    {money(r().seats.find((s) => s.seat === h.seat)?.stack ?? 0)}
                  </span>
                </div>
                <div class="mt-0.5 flex gap-1">
                  <For each={h.cards}>{(c) => <Card {...c} size="sm" />}</For>
                </div>
              </div>
            )}
          </For>
        </div>
      </section>

      {/* board(s) */}
      <Show when={r().boardRows.length > 0}>
        <section>
          <SectionTitle>Board</SectionTitle>
          <div class="flex flex-col gap-1.5">
            <For each={r().boardRows}>
              {(row) => (
                <div class="flex items-center gap-2">
                  <Show when={row.label}>
                    <span class="w-10 shrink-0 text-[10px] font-bold uppercase leading-tight tracking-wider text-marigold">{row.label}</span>
                  </Show>
                  <div class="flex gap-0.5">
                    <For each={row.streets}>
                      {(s) => (
                        <For each={s.cards}>
                          {(c) => <Card {...c} size="sm" />}
                        </For>
                      )}
                    </For>
                  </div>
                </div>
              )}
            </For>
          </div>
        </section>
      </Show>

      {/* action log per street */}
      <section>
        <SectionTitle>Action</SectionTitle>
        <div class="flex flex-col gap-1.5">
          <For each={r().streets}>
            {(street) => (
              <div>
                <div class="text-[11px] font-bold uppercase tracking-wider text-fg-muted">{street.street}</div>
                <div class="flex flex-col">
                  <For each={street.lines}>
                    {(line) => (
                      <div class="flex items-baseline gap-2 px-1 text-xs">
                        <span class="min-w-16 truncate font-semibold">{line.player}</span>
                        <span class="text-fg-muted">{line.text}</span>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
        </div>
      </section>

      {/* result */}
      <section>
        <SectionTitle>Result</SectionTitle>
        <div class="flex flex-col gap-0.5">
          <For each={r().awards}>
            {(a) => (
              <div class="text-xs">
                <span class="font-semibold text-accent">{a.player}</span> wins {money(a.amountCents)}
                <Show when={a.handName}> — {a.handName}</Show>
                <Show when={a.boardLabel}> ({a.boardLabel})</Show>
              </div>
            )}
          </For>
          <For each={r().bounties}>
            {(b) => (
              <div class="text-xs font-semibold text-marigold">
                {b.player} wins {money(b.amountCents)} bounty w/ 7-2!
              </div>
            )}
          </For>
          <Show when={r().rabbit.length > 0}>
            <div class="mt-1 flex items-center gap-1.5 text-[11px] text-fg-muted">
              rabbit: <For each={r().rabbit}>{(c) => <Card {...c} size="sm" class="opacity-55 saturate-50 -rotate-6" />}</For>
            </div>
          </Show>
        </div>
      </section>
    </div>
  )
}

const SectionTitle = (props: { children: string }) => (
  <h3 class="mb-1 text-[11px] font-bold uppercase tracking-wider text-fg-muted">{props.children}</h3>
)

function EmptyState(props: { title: string; children: import('solid-js').JSX.Element }) {
  return (
    <div class="mt-10 flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-line px-6 py-8 text-center">
      <div class="font-display text-sm font-bold">{props.title}</div>
      <p class="text-xs text-fg-muted">{props.children}</p>
    </div>
  )
}
