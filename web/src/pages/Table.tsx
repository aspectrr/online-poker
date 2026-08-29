import { createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { useParams, A } from '@solidjs/router'
import { provideTable } from '../stores/table'
import { createDemoTable } from '../stores/demoTable'
import type { TableStore } from '../lib/protocol'
import { Seat } from '../components/table/Seat'
import { TableCenter } from '../components/table/TableCenter'
import { ActionBar } from '../components/table/ActionBar'
import { blinds } from '../lib/money'

const API_URL = import.meta.env.VITE_API_URL as string | undefined

/** Ellipse seat positions (fractions of the felt box) for up to 9 seats. */
const SEAT_POS: Record<number, [number, number][]> = {
  2: [[0.5, 0.95], [0.5, 0.08]],
  3: [[0.5, 0.95], [0.09, 0.5], [0.91, 0.5]],
  4: [[0.5, 0.95], [0.09, 0.5], [0.5, 0.08], [0.91, 0.5]],
  5: [[0.5, 0.95], [0.1, 0.72], [0.18, 0.14], [0.82, 0.14], [0.9, 0.72]],
  6: [[0.5, 0.95], [0.08, 0.68], [0.2, 0.12], [0.5, 0.08], [0.8, 0.12], [0.92, 0.68]],
  7: [[0.5, 0.95], [0.07, 0.72], [0.16, 0.16], [0.38, 0.08], [0.62, 0.08], [0.84, 0.16], [0.93, 0.72]],
  8: [[0.5, 0.95], [0.06, 0.75], [0.14, 0.22], [0.32, 0.1], [0.5, 0.08], [0.68, 0.1], [0.86, 0.22], [0.94, 0.75]],
  9: [[0.5, 0.95], [0.06, 0.76], [0.13, 0.28], [0.27, 0.11], [0.44, 0.08], [0.56, 0.08], [0.73, 0.11], [0.87, 0.28], [0.94, 0.76]],
}

/** Now-ms ticker for countdown arcs (single interval for all seats). */
function useClock() {
  const [now, setNow] = createSignal(Date.now())
  let iv: ReturnType<typeof setInterval>
  onMount(() => { iv = setInterval(() => setNow(Date.now()), 250) })
  onCleanup(() => clearInterval(iv))
  return now
}

export function TablePage() {
  const params = useParams()
  // ASPTR-199: VITE_API_URL set -> live ws store; unset -> scripted demo hand.
  const store: TableStore = API_URL
    ? provideTable(params.id ?? 'dev-table')
    : createDemoTable(params.id ?? 'demo')
  onCleanup(() => store.dispose())
  const now = useClock()

  const t = () => store.state
  const positions = () => SEAT_POS[Math.min(t().maxSeats, 9)] ?? SEAT_POS[6]

  const deadline = () => t().deadlineUnixMs
  const fracFor = (seat: number) => {
    const dl = deadline()
    if (dl == null || t().toAct !== seat) return 1
    const ms = Math.max(0, dl - now())
    return Math.min(1, ms / Math.max(1000, t().turnTimeoutMs))
  }
  const msLeftFor = (seat: number) => {
    const dl = deadline()
    if (dl == null || t().toAct !== seat) return null
    return Math.max(0, dl - now())
  }

  // chips-to-winner: fly chips from center to winner seat
  const winners = () => t().seats.filter((s) => s.isWinner)

  return (
    <div class="flex h-dvh flex-col overflow-hidden felt-bg">
      {/* header */}
      <header class="flex h-12 flex-none items-center justify-between border-b border-line/60 bg-bg/70 px-4 backdrop-blur-md">
        <div class="flex items-center gap-3">
          <A href="/" class="text-sm font-medium text-fg-muted transition-colors hover:text-fg">← lobby</A>
          <span class="font-display text-sm font-bold text-fg">{t().name}</span>
          <span class="rounded bg-surface-raised px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-fg-muted">
            {t().gameType}
          </span>
          <span class="text-xs tabular-nums text-fg-muted">{blinds(t().sbCents, t().bbCents)}</span>
        </div>
        <span class="text-xs tabular-nums text-fg-muted">
          <Show when={t().handNo > 0}>hand #{t().handNo} · </Show>
          <Show when={t().bombPot}><span class="font-bold text-accent">BOMB POT · </span></Show>
          {t().street}
        </span>
      </header>

      {/* table area */}
      <main class="relative flex min-h-0 flex-1 items-center justify-center p-3 sm:p-6">
        <div class="relative aspect-[16/10] max-h-full w-full max-w-5xl">
          {/* rail */}
          <div class="absolute inset-0 rounded-[999px_/280px] rounded-[50%] border border-[#3a2b1d] bg-gradient-to-b from-[#4a3626] via-[#33241a] to-[#221810] p-[14px] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7),inset_0_2px_2px_rgba(255,255,255,0.08)]">
            {/* felt */}
            <div class="relative h-full w-full overflow-hidden rounded-[50%] border border-black/50 shadow-[inset_0_0_60px_rgba(0,0,0,0.55)]"
              style="background: radial-gradient(ellipse 75% 70% at 50% 42%, #1f6f4a 0%, #175a3c 45%, #0f4530 75%, #0b3625 100%)">
              {/* subtle felt texture + inner ring */}
              <div class="absolute inset-0 opacity-[0.05]"
                style="background-image: repeating-linear-gradient(45deg, #fff 0 1px, transparent 1px 3px), repeating-linear-gradient(-45deg, #fff 0 1px, transparent 1px 3px)" />
              <div class="absolute inset-[7%] rounded-[50%] border border-white/10" />

              <TableCenter table={t()} dealKey={`${t().handNo}`} />
            </div>
          </div>

          {/* seats */}
          <For each={t().seats}>
            {(seat) => {
              const [fx, fy] = positions()[seat.seat] ?? [0.5, 0.5]
              const canJoin = () => t().heroSeat < 0 && !seat.player && store.status === 'open'
              return (
                <Seat
                  seat={seat}
                  table={t()}
                  msLeft={msLeftFor(seat.seat)}
                  frac={fracFor(seat.seat)}
                  isHero={seat.seat === t().heroSeat}
                  onJoin={canJoin() ? () => store.joinSeat(seat.seat) : undefined}
                  style={`left:${fx * 100}%; top:${fy * 100}%`}
                />
              )
            }}
          </For>

          {/* chips flying to winner */}
          <For each={winners()}>
            {(w) => <ChipFly toSeat={positions()[w.seat] ?? [0.5, 0.5]} />}
          </For>
        </div>
      </main>

      {/* action bar */}
      <footer class="flex-none px-3 pb-3 sm:px-6 sm:pb-4">
        <ActionBar table={t()} send={(a) => store.send(a)} error={store.lastError} />
      </footer>

      {/* toasts (7-2 bounty, …) */}
      <div class="pointer-events-none fixed inset-x-0 top-14 z-50 flex flex-col items-center gap-1.5">
        <For each={store.toasts}>
          {(toast) => (
            <div class="rounded-full border border-accent/40 bg-surface/95 px-4 py-1.5 text-sm font-semibold text-accent shadow-lg">
              {toast.text}
            </div>
          )}
        </For>
      </div>
    </div>
  )
}

/** Pot → winner chip burst. Origin = felt center; target = seat position. */
function ChipFly(props: { toSeat: [number, number] }) {
  let host: HTMLDivElement | undefined
  const [vars, setVars] = createSignal<Record<string, string>>({})
  onMount(() => {
    // host fills the felt box; target offset = seat fraction − center
    const w = host?.parentElement?.clientWidth ?? 0
    const h = host?.parentElement?.clientHeight ?? 0
    setVars({
      '--chip-x': `${props.toSeat[0] * w - w / 2}px`,
      '--chip-y': `${props.toSeat[1] * h - h / 2}px`,
    })
  })
  return (
    <div ref={host} class="pointer-events-none absolute inset-0 grid place-items-center">
      <div class="relative">
        <For each={[0, 1, 2, 3, 4, 5]}>
          {(_, i) => (
            <span class="chip chip-fly absolute" style={{ ...vars(), 'animation-delay': `${i() * 70}ms` }} />
          )}
        </For>
      </div>
    </div>
  )
}
