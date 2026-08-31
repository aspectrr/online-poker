import { createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { useParams, A, useLocation } from '@solidjs/router'
import { provideTable } from '../stores/table'
import { createDemoTable } from '../stores/demoTable'
import type { TableStore, UICard } from '../lib/protocol'
import { Seat } from '../components/table/Seat'
import { TableCenter } from '../components/table/TableCenter'
import { ActionBar } from '../components/table/ActionBar'
import { SettingsDrawer } from '../components/table/SettingsDrawer'
import { HistoryDrawer } from '../components/table/HistoryDrawer'
import { Card } from '../components/cards/Card'
import { RabbitMark } from '../components/cards/RabbitMark'
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
  const location = useLocation()
  // hidden dev flag: ?deal=7d2s forces the hero's next hole cards (dev builds)
  const dealParam = new URLSearchParams(location.search).get('deal') ?? undefined
  // ASPTR-199: VITE_API_URL set -> live ws store; unset -> scripted demo hand.
  const store: TableStore = API_URL
    ? provideTable(params.id ?? 'dev-table', dealParam ?? undefined)
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

  // felt box size for deal-flight offsets (center deck -> seat)
  let feltBox: HTMLDivElement | undefined
  const [feltSize, setFeltSize] = createSignal({ w: 1024, h: 640 })
  onMount(() => {
    const measure = () => {
      if (feltBox) setFeltSize({ w: feltBox.clientWidth, h: feltBox.clientHeight })
    }
    measure()
    window.addEventListener('resize', measure)
    onCleanup(() => window.removeEventListener('resize', measure))
  })

  const [drawerOpen, setDrawerOpen] = createSignal(false)
  const [historyOpen, setHistoryOpen] = createSignal(false)

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
        <div class="flex items-center gap-3">
          <span class="text-xs tabular-nums text-fg-muted">
            <Show when={t().handNo > 0}>hand #{t().handNo} · </Show>
            <Show when={t().bombPot}><span class="font-bold text-accent">BOMB POT · </span></Show>
            {t().street}
          </span>
          <button
            type="button"
            title="Hand history"
            class="grid size-7 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg"
            onClick={() => setHistoryOpen(true)}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" class="size-4" aria-hidden="true">
              <path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm1-12.5v4.29l2.04 1.17a.75.75 0 0 1-.75 1.3l-2.41-1.39a.75.75 0 0 1-.38-.65V5.5a.75.75 0 0 1 1.5 0Z" clip-rule="evenodd" />
            </svg>
          </button>
          <button
            type="button"
            title="Table settings"
            class="grid size-7 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg"
            onClick={() => setDrawerOpen(true)}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" class="size-4" aria-hidden="true">
              <path fill-rule="evenodd" d="M10 3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM3.5 8.5a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Zm9 0a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0ZM10 14a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" clip-rule="evenodd" />
            </svg>
          </button>
        </div>
      </header>

      {/* bomb pot banners: armed-for-next-hand (persistent) + live hand */}
      <Show when={t().bombPot || t().bombPotArmed != null}>
        <div class="pointer-events-none absolute inset-x-0 top-14 z-40 flex justify-center">
          <Show
            when={t().bombPot}
            fallback={
              <div class="animate-in-pop flex items-center gap-2.5 rounded-xl border border-marigold/70 bg-surface/95 px-4 py-2 shadow-lg">
                <Show when={typeof t().bombPotArmed === 'object'}>
                  <Card {...(t().bombPotArmed as UICard)} size="sm" />
                </Show>
                <div>
                  <div class="text-sm font-bold tracking-wide text-marigold">NEXT HAND: DOUBLE BOARD PLO BOMB POT</div>
                  <div class="text-[11px] text-fg-muted">everyone antes · 4 cards · no preflop betting</div>
                </div>
              </div>
            }
          >
            <div class="animate-in-pop rounded-xl border border-danger/70 bg-surface/95 px-4 py-2 text-center shadow-lg">
              <div class="text-sm font-bold tracking-wide text-danger">DOUBLE BOARD PLO BOMB POT</div>
              <div class="text-[11px] text-fg-muted">winner per board — ½ pot each</div>
            </div>
          </Show>
        </div>
      </Show>

      {/* table area */}
      <main class="relative flex min-h-0 flex-1 items-center justify-center p-3 sm:p-6">
        <div ref={feltBox} class="relative aspect-[16/10] max-h-full w-full max-w-5xl">
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
                  dealt={t().dealt[seat.seat] ?? 0}
                  dealDx={(0.5 - fx) * feltSize().w}
                  dealDy={(0.5 - fy) * feltSize().h}
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

      {/* toasts (7-2 bounty gold, rabbit hunt mascot) */}
      <div class="pointer-events-none fixed inset-x-0 top-14 z-50 flex flex-col items-center gap-1.5">
        <For each={store.toasts}>
          {(toast) => (
            <Show
              when={toast.kind === 'gold'}
              fallback={
                <Show
                  when={toast.kind === 'rabbit'}
                  fallback={
                    <div class="rounded-full border border-accent/40 bg-surface/95 px-4 py-1.5 text-sm font-semibold text-accent shadow-lg">
                      {toast.text}
                    </div>
                  }
                >
                  <div class="flex items-center gap-2 rounded-full border border-line bg-surface/95 px-4 py-1.5 text-sm font-semibold text-fg shadow-lg">
                    <RabbitMark class="size-5" />
                    {toast.text}
                  </div>
                </Show>
              }
            >
              <div class="animate-toast-gold flex items-center gap-2 rounded-xl border-2 border-marigold bg-marigold/15 px-5 py-2.5 text-base font-bold text-marigold shadow-[0_0_28px_rgba(255,177,16,0.4)]">
                {toast.text}
              </div>
            </Show>
          )}
        </For>
      </div>

      {/* read-only settings drawer */}
      <SettingsDrawer
        open={drawerOpen()}
        cfg={t().cfg}
        gameType={t().gameType}
        blinds={blinds(t().sbCents, t().bbCents)}
        bombPotLive={t().bombPot}
        onArmBombPot={() => store.armBombPot()}
        onClose={() => setDrawerOpen(false)}
      />

      {/* hand-history drawer */}
      <HistoryDrawer open={historyOpen()} tableId={params.id ?? 'dev-table'} onClose={() => setHistoryOpen(false)} />
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
