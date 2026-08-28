import { For, Show, createResource, createSignal } from 'solid-js'
import { A } from '@solidjs/router'
import { Button } from '../components/ui/Button'
import { CreateTableDialog } from '../components/CreateTableDialog'
import { MOCK_MODE, joinTable, listTables } from '../lib/api'
import { blinds, money } from '../lib/money'
import type { TableSummary } from '../lib/types'
import { cn } from '../lib/cn'

export function LobbyPage() {
  const [tables, { refetch }] = createResource(listTables)
  const [joined, setJoined] = createSignal<string | null>(null)

  const onJoin = async (t: TableSummary) => {
    await joinTable(t.id)
    setJoined(t.id)
    // ponytail: no table route yet — ack join inline; navigate when /table/:id exists.
  }

  return (
    <div class="min-h-dvh felt-bg">
      <header class="border-b border-line/60 bg-bg/70 backdrop-blur-md sticky top-0 z-40">
        <div class="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <A href="/" class="flex items-center gap-2.5">
            <span class="grid size-8 place-items-center rounded-lg bg-accent/15 text-accent ring-1 ring-accent/30">
              <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M4 9c5.5 0 10.5-2 16-2v10c-5.5 0-10.5 2-16 2V9Z" />
                <path d="M4 11c1.5 0 2.5 1 2.5 2S5.5 15 4 15" />
              </svg>
            </span>
            <span class="font-display text-base font-bold tracking-tight text-fg">
              aspectrr
            </span>
          </A>
          <div class="flex items-center gap-3">
            <Show when={MOCK_MODE}>
              <span class="hidden rounded-full border border-line bg-surface px-2.5 py-0.5 text-xs font-medium text-fg-muted sm:inline">
                mock data
              </span>
            </Show>
            <A href="/auth">
              <Button variant="outline" size="sm">
                Sign in
              </Button>
            </A>
          </div>
        </div>
      </header>

      <main class="mx-auto max-w-6xl px-4 pt-8 pb-16 sm:px-6">
        <div class="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 class="font-display text-2xl font-bold tracking-tight text-fg sm:text-3xl">
              Tables
            </h1>
            <p class="mt-1 text-sm text-fg-muted">
              <Show when={tables.latest} fallback="Loading tables…">
                {(list) => <>
                  {list().length} live
                  <Show when={MOCK_MODE}> · demo lobby, backend not configured</Show>
                </>}
              </Show>
            </p>
          </div>
          <CreateTableDialog onCreated={() => refetch()} />
        </div>

        <Show
          when={!tables.loading && tables.latest?.length}
          fallback={
            <Show when={!tables.loading} fallback={<TableSkeleton />}>
              <div class="mt-10 grid place-items-center rounded-2xl border border-dashed border-line bg-surface/40 px-6 py-16 text-center">
                <p class="font-medium text-fg">No tables yet</p>
                <p class="mt-1 text-sm text-fg-muted">Deal yourself in — create the first table.</p>
              </div>
            </Show>
          }
        >
          <div class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <For each={tables.latest}>
              {(t) => <TableCard table={t} joined={joined() === t.id} onJoin={() => onJoin(t)} />}
            </For>
          </div>
        </Show>
      </main>
    </div>
  )
}

function TableSkeleton() {
  return (
    <div class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }, (_, i) => (
        <div data-i={i} class="h-44 animate-pulse rounded-2xl border border-line bg-surface/60" />
      ))}
    </div>
  )
}

function TableCard(props: { table: TableSummary; joined: boolean; onJoin: () => void }) {
  const t = () => props.table
  const full = () => t().seatsFilled >= t().maxSeats
  return (
    <article class="group flex flex-col rounded-2xl border border-line bg-surface p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-lg hover:shadow-black/30">
      <div class="flex items-start justify-between gap-3">
        <h2 class="font-display text-base font-semibold leading-tight text-fg">{t().name}</h2>
        <span
          class={cn(
            'flex-none rounded-md px-2 py-0.5 text-[11px] font-bold tracking-wider',
            t().gameType === 'PLO4'
              ? 'bg-accent/15 text-accent ring-1 ring-accent/30'
              : 'bg-surface-raised text-fg-muted ring-1 ring-line',
          )}
        >
          {t().gameType}
        </span>
      </div>

      <dl class="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div class="flex flex-col">
          <dt class="text-xs text-fg-muted">Blinds</dt>
          <dd class="font-medium tabular-nums text-fg">{blinds(t().smallBlindCents, t().bigBlindCents)}</dd>
        </div>
        <div class="flex flex-col">
          <dt class="text-xs text-fg-muted">Avg pot</dt>
          <dd class="font-medium tabular-nums text-fg">
            {t().avgPotCents != null ? money(t().avgPotCents!) : '—'}
          </dd>
        </div>
      </dl>

      <div class="mt-4 flex items-center gap-1.5" role="img" aria-label={`${t().seatsFilled} of ${t().maxSeats} seats taken`}>
        <For each={Array.from({ length: t().maxSeats })}>
          {(_, i) => (
            <span
              class={cn(
                'h-1.5 flex-1 rounded-full transition-colors',
                i() < t().seatsFilled ? 'bg-accent/80' : 'bg-surface-raised',
              )}
            />
          )}
        </For>
      </div>

      <div class="mt-5 flex items-center justify-between">
        <span class="text-sm tabular-nums text-fg-muted">
          {t().seatsFilled}/{t().maxSeats} seated
        </span>
        <Show
          when={!full()}
          fallback={<span class="text-sm font-medium text-danger">Full</span>}
        >
          <Button size="sm" variant={props.joined ? 'outline' : 'default'} onClick={props.onJoin}>
            {props.joined ? 'Seated ✓' : 'Join'}
          </Button>
        </Show>
      </div>
    </article>
  )
}

