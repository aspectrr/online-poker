import {
  createSignal,
  createComputed,
  createEffect,
  For,
  Index,
  on,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { useParams, A, useLocation } from "@solidjs/router";
import { provideTable, BUTTON_TRAVEL_MS } from "../stores/table";
import { createDemoTable } from "../stores/demoTable";
import type { TableStore, UICard } from "../lib/protocol";
import { Seat } from "../components/table/Seat";
import { ChipStack } from "../components/table/ChipStack";
import { JoinModal } from "../components/table/JoinModal";
import { TableCenter } from "../components/table/TableCenter";
import { TableMobile } from "../components/table/TableMobile";
import { ActionBar } from "../components/table/ActionBar";
import { SettingsDrawer } from "../components/table/SettingsDrawer";
import { HistoryDrawer } from "../components/table/HistoryDrawer";
import { FeedbackDialog } from "../components/FeedbackDialog";
import { Card } from "../components/cards/Card";
import { RabbitMark } from "../components/cards/RabbitMark";
import { blinds, money } from "../lib/money";

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

/** Felt design box (16/10) — seats/center are laid out at this size, then scaled as one unit (ASPTR-193 landscape pass). */
const DESIGN_W = 1024;
const DESIGN_H = 640;
/** bottom-center seat (at 95%) overhangs the box by ~half its height — budget it so the action bar never covers the hero */
const SEAT_OVERHANG = 160;

/** Ellipse seat positions (fractions of the felt box) for up to 9 seats. */
const SEAT_POS: Record<number, [number, number][]> = {
  2: [
    [0.5, 0.95],
    [0.5, 0.08],
  ],
  3: [
    [0.5, 0.95],
    [0.09, 0.5],
    [0.91, 0.5],
  ],
  4: [
    [0.5, 0.95],
    [0.09, 0.5],
    [0.5, 0.08],
    [0.91, 0.5],
  ],
  5: [
    [0.5, 0.95],
    [0.1, 0.72],
    [0.18, 0.14],
    [0.82, 0.14],
    [0.9, 0.72],
  ],
  6: [
    [0.5, 0.95],
    [0.08, 0.68],
    [0.2, 0.12],
    [0.5, 0.08],
    [0.8, 0.12],
    [0.92, 0.68],
  ],
  7: [
    [0.5, 0.95],
    [0.07, 0.72],
    [0.16, 0.16],
    [0.38, 0.08],
    [0.62, 0.08],
    [0.84, 0.16],
    [0.93, 0.72],
  ],
  8: [
    [0.5, 0.95],
    [0.06, 0.75],
    [0.14, 0.22],
    [0.32, 0.1],
    [0.5, 0.08],
    [0.68, 0.1],
    [0.86, 0.22],
    [0.94, 0.75],
  ],
  9: [
    [0.5, 0.95],
    [0.06, 0.76],
    [0.13, 0.28],
    [0.27, 0.11],
    [0.44, 0.08],
    [0.56, 0.08],
    [0.73, 0.11],
    [0.87, 0.28],
    [0.94, 0.76],
  ],
};

/** Now-ms ticker for countdown arcs (single interval for all seats). */
function useClock() {
  const [now, setNow] = createSignal(Date.now());
  let iv: ReturnType<typeof setInterval>;
  onMount(() => {
    iv = setInterval(() => setNow(Date.now()), 250);
  });
  onCleanup(() => clearInterval(iv));
  return now;
}

/** Compact (phone) layout when the felt design box can't stay readable:
 *  narrow viewports, or short ones where the scaled felt would shrink text
 *  past ~6px (large-phone landscape). Desktop/tablet keep the felt. */
function useCompact() {
  const [compact, setCompact] = createSignal(false);
  onMount(() => {
    const mq = window.matchMedia("(max-width: 639px), (max-height: 559px)");
    const update = () => setCompact(mq.matches);
    update();
    mq.addEventListener("change", update);
    onCleanup(() => mq.removeEventListener("change", update));
  });
  return compact;
}

export function TablePage() {
  const params = useParams();
  const location = useLocation();
  // hidden dev flag: ?deal=7d2s forces the hero's next hole cards (dev builds)
  const dealParam = new URLSearchParams(location.search).get("deal") ?? undefined;
  // ASPTR-199: VITE_API_URL set -> live ws store; unset -> scripted demo hand.
  const store: TableStore = API_URL
    ? provideTable(params.id ?? "dev-table", dealParam ?? undefined)
    : createDemoTable(params.id ?? "demo");
  onCleanup(() => store.dispose());
  const now = useClock();

  const t = () => store.state;
  const compact = useCompact();
  const positions = () => SEAT_POS[Math.min(t().maxSeats, 9)] ?? SEAT_POS[6];

  /** Seat ellipse position rotated so the seated viewer (hero) always sits
   *  at the bottom-center slot, whatever seat they picked; spectators see
   *  the table unrotated. */
  const posFor = (seatNo: number): [number, number] => {
    const arr = positions();
    const n = arr.length;
    const hero = t().heroSeat;
    const idx = hero >= 0 && hero < n ? (((seatNo - hero) % n) + n) % n : seatNo % n;
    return arr[idx] ?? [0.5, 0.5];
  };
  /** per-seat positions for the dealer button (indexed by seat order). */
  const seatPositions = (): [number, number][] => t().seats.map((s) => posFor(s.seat));

  const deadline = () => t().deadlineUnixMs;
  const fracFor = (seat: number) => {
    const dl = deadline();
    if (dl == null || t().toAct !== seat) return 1;
    const ms = Math.max(0, dl - now());
    return Math.min(1, ms / Math.max(1000, t().turnTimeoutMs));
  };
  const msLeftFor = (seat: number) => {
    const dl = deadline();
    if (dl == null || t().toAct !== seat) return null;
    return Math.max(0, dl - now());
  };

  // felt fit: scale the fixed design box to the available area (seats never overlap on small screens)
  const [scale, setScale] = createSignal(1);
  // eslint-disable-next-line no-unassigned-vars -- Solid ref capture assigns this
  let hostBox: HTMLDivElement | undefined;
  // eslint-disable-next-line no-unassigned-vars -- Solid ref capture assigns this
  let footerEl: HTMLElement | undefined;
  onMount(() => {
    const measure = () => {
      if (!hostBox) return;
      const s = Math.min(
        hostBox.clientWidth / DESIGN_W,
        hostBox.clientHeight / (DESIGN_H + SEAT_OVERHANG),
      );
      if (s > 0) setScale(s);
    };
    measure();
    window.addEventListener("resize", measure);
    onCleanup(() => window.removeEventListener("resize", measure));
    // the felt box only exists outside the compact layout — re-measure when
    // crossing the breakpoint (rotation) once it mounts
    createEffect(on(compact, () => queueMicrotask(measure)));
  });

  const [drawerOpen, setDrawerOpen] = createSignal(false);
  const [historyOpen, setHistoryOpen] = createSignal(false);

  // share link: copy this table's URL (minus dev params) to the clipboard
  const [copied, setCopied] = createSignal(false);
  const shareLink = () => {
    const u = new URL(window.location.href);
    u.searchParams.delete("dev");
    u.searchParams.delete("deal");
    navigator.clipboard.writeText(u.toString()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  // join modal: shows while connected + unseated; "just watching" dismisses,
  // clicking an empty seat reopens it with that seat preselected
  const [spectating, setSpectating] = createSignal(false);
  const [presetSeat, setPresetSeat] = createSignal<number | undefined>(undefined);
  const joinOpen = () => store.status === "open" && t().heroSeat < 0 && !spectating();
  const openJoinAt = (seat: number) => {
    setPresetSeat(seat);
    setSpectating(false);
  };

  // peek: hero cards stay face-down; hold to look (mimics protecting your hand)
  const [peeking, setPeeking] = createSignal(false);
  createEffect(
    on(
      () => t().handNo,
      () => setPeeking(false), // new hand: cards go back in the dark
    ),
  );

  // card visibility preference: hold-to-peek (default) or always open.
  // Client-local (localStorage) — not part of the table config.
  const [cardsOpen, setCardsOpen] = createSignal(localStorage.getItem("rr:cards") === "open");
  const setCardPref = (open: boolean) => {
    setCardsOpen(open);
    localStorage.setItem("rr:cards", open ? "open" : "hold");
  };
  const heroPeeking = () => cardsOpen() || peeking();
  // one-time tip until the player has peeked at least once
  const [everPeeked, setEverPeeked] = createSignal(localStorage.getItem("rr:peeked") === "1");
  const setPeeked = (v: boolean) => {
    setPeeking(v);
    if (v) {
      localStorage.setItem("rr:peeked", "1");
      setEverPeeked(true);
    }
  };
  const peekTip = () =>
    !cardsOpen() && !everPeeked() && t().holeCards.length > 0
      ? "tip: press and hold your cards to peek at them"
      : null;

  // reconnect banner (ASPTR-193): surface ws drops; suppress the initial connecting flash
  const [everOpen, setEverOpen] = createSignal(false);
  createComputed(() => {
    if (store.status === "open") setEverOpen(true);
  });
  const showReconnect = () =>
    store.status === "closed" || (store.status === "connecting" && everOpen());

  // chips-to-winner: fly chips from center to winner seat
  const winners = () => t().seats.filter((s) => s.isWinner);

  return (
    <div class="flex h-dvh flex-col overflow-hidden">
      {/* header */}
      <header class="flex h-12 flex-none items-center justify-between border-b border-line/60 bg-bg/70 px-4 backdrop-blur-md [@media(max-height:520px)]:h-10">
        <div class="flex items-center gap-3">
          <A href="/" class="text-sm font-medium text-fg-muted transition-colors hover:text-fg">
            ← lobby
          </A>
          <span class="max-w-28 truncate font-display text-sm font-bold text-fg min-[640px]:max-w-none">
            {t().name}
          </span>
          <span class="hidden rounded bg-surface-raised px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-fg-muted min-[640px]:inline">
            {t().gameType}
          </span>
          <span class="hidden text-xs tabular-nums text-fg-muted min-[640px]:inline">
            {blinds(t().sbCents, t().bbCents)}
          </span>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-xs tabular-nums text-fg-muted">
            <Show when={t().handNo > 0}>
              <span class="min-[420px]:inline hidden">hand #{t().handNo} · </span>
            </Show>
            <Show when={t().bombPot}>
              <span class="font-bold text-accent">BOMB · </span>
            </Show>
            <Show when={t().texasDrop}>
              <span class="font-bold text-accent">DROP · </span>
            </Show>
            {t().street}
          </span>
          <button
            type="button"
            title={copied() ? "Link copied!" : "Copy invite link"}
            aria-label="Copy invite link"
            class="grid size-7 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg"
            onClick={shareLink}
          >
            <Show
              when={copied()}
              fallback={
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  class="size-4"
                  aria-hidden="true"
                >
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
              }
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="size-4 text-accent"
                aria-hidden="true"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </Show>
          </button>
          <button
            type="button"
            title="Hand history"
            aria-label="Hand history"
            class="grid size-7 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg"
            onClick={() => setHistoryOpen(true)}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" class="size-4" aria-hidden="true">
              <path
                fill-rule="evenodd"
                d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm1-12.5v4.29l2.04 1.17a.75.75 0 0 1-.75 1.3l-2.41-1.39a.75.75 0 0 1-.38-.65V5.5a.75.75 0 0 1 1.5 0Z"
                clip-rule="evenodd"
              />
            </svg>
          </button>
          <button
            type="button"
            title="Table settings"
            aria-label="Table settings"
            class="grid size-7 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg"
            onClick={() => setDrawerOpen(true)}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" class="size-4" aria-hidden="true">
              <path
                fill-rule="evenodd"
                d="M10 3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM3.5 8.5a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Zm9 0a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0ZM10 14a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z"
                clip-rule="evenodd"
              />
            </svg>
          </button>
        </div>
      </header>

      {/* reconnect banner (ASPTR-193): store auto-reconnects; this just surfaces it.
          Header-strip placement — over the felt it covered the top seat. */}
      <Show when={showReconnect()}>
        <div class="pointer-events-none absolute inset-x-0 top-1 z-50 flex justify-center [@media(max-height:520px)]:top-0.5">
          <div class="animate-in-pop flex items-center gap-2 rounded-full border border-marigold/70 bg-surface/95 px-3.5 py-1 shadow-lg">
            <span class="relative flex size-2">
              <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-marigold opacity-75" />
              <span class="relative inline-flex size-2 rounded-full bg-marigold" />
            </span>
            <span class="text-sm font-medium text-fg">
              {store.status === "closed" ? "Connection lost — reconnecting…" : "Reconnecting…"}
            </span>
          </div>
        </div>
      </Show>

      {/* Texas Drop banners: armed-for-next-hand + live game (round counter).
          Header-strip placement — over the felt they covered the top seat. */}
      <Show when={t().banner === "drop" || t().banner === "drop_armed"}>
        <div class="pointer-events-none absolute inset-x-0 top-1 z-50 flex justify-center">
          <Show
            when={t().banner === "drop"}
            fallback={
              <div class="animate-in-pop rounded-xl border border-accent/70 bg-surface/95 px-4 py-2 text-center shadow-lg">
                <div class="text-sm font-bold tracking-wide text-accent">NEXT HAND: TEXAS DROP</div>
                <div class="text-[11px] text-fg-muted">
                  everyone antes {money(t().cfg.texasDropAnte)} · board runs out · stay or drop
                </div>
              </div>
            }
          >
            <div class="animate-in-pop rounded-xl border border-accent/70 bg-surface/95 px-4 py-2 text-center shadow-lg">
              <div class="text-sm font-bold tracking-wide text-accent">TEXAS DROP</div>
              <div class="text-[11px] text-fg-muted">
                {t().dropPhase
                  ? `round ${t().dropPhase?.round} — ${t().dropPhase?.waiting} still to choose`
                  : "board incoming"}
              </div>
            </div>
          </Show>
        </div>
      </Show>

      {/* bomb pot banners: armed-for-next-hand (persistent) + live hand */}
      <Show when={t().banner === "bomb" || t().banner === "bomb_armed"}>
        <div class="pointer-events-none absolute inset-x-0 top-1 z-50 flex justify-center">
          <Show
            when={t().banner === "bomb"}
            fallback={
              <div class="animate-in-pop flex items-center gap-2.5 rounded-xl border border-marigold/70 bg-surface/95 px-4 py-2 shadow-lg">
                <Show when={typeof t().bombPotArmed === "object"}>
                  <Card {...(t().bombPotArmed as UICard)} size="sm" />
                </Show>
                <div>
                  <div class="text-sm font-bold tracking-wide text-marigold">
                    NEXT HAND: DOUBLE BOARD PLO BOMB POT
                  </div>
                  <div class="text-[11px] text-fg-muted">
                    everyone antes · 4 cards · no preflop betting
                  </div>
                </div>
              </div>
            }
          >
            <div class="animate-in-pop rounded-xl border border-danger/70 bg-surface/95 px-4 py-2 text-center shadow-lg [@media(max-width:639px)]:hidden [@media(max-height:559px)]:hidden">
              <div class="text-sm font-bold tracking-wide text-danger">
                DOUBLE BOARD PLO BOMB POT
              </div>
              <div class="text-[11px] text-fg-muted">winner per board — ½ pot each</div>
            </div>
          </Show>
        </div>
      </Show>

      {/* table area — phones get the compact layout; desktop/tablet the felt design box */}
      <main class="relative flex min-h-0 flex-1 items-center justify-center p-2 sm:p-6">
        <Show
          when={compact()}
          fallback={
            <div ref={hostBox} class="grid h-full w-full place-items-center">
              <div
                class="relative"
                style={{
                  width: `${DESIGN_W * scale()}px`,
                  height: `${(DESIGN_H + SEAT_OVERHANG) * scale()}px`,
                }}
              >
                <div
                  class="absolute left-0 top-0 origin-top-left"
                  style={{
                    width: `${DESIGN_W}px`,
                    height: `${DESIGN_H}px`,
                    transform: `scale(${scale()})`,
                  }}
                >
                  {/* rail */}
                  <div class="absolute inset-0 rounded-[999px_/280px] rounded-[50%] border border-[#3a2b1d] bg-gradient-to-b from-[#4a3626] via-[#33241a] to-[#221810] p-[14px] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7),inset_0_2px_2px_rgba(255,255,255,0.08)]">
                    {/* felt */}
                    <div
                      class="relative h-full w-full overflow-hidden rounded-[50%] border border-black/50 shadow-[inset_0_0_60px_rgba(0,0,0,0.55)]"
                      style="background: radial-gradient(ellipse 75% 70% at 50% 42%, #1f6f4a 0%, #175a3c 45%, #0f4530 75%, #0b3625 100%)"
                    >
                      {/* subtle felt texture + inner ring */}
                      <div
                        class="absolute inset-0 opacity-[0.05]"
                        style="background-image: repeating-linear-gradient(45deg, #fff 0 1px, transparent 1px 3px), repeating-linear-gradient(-45deg, #fff 0 1px, transparent 1px 3px)"
                      />
                      <div class="absolute inset-[7%] rounded-[50%] border border-white/10" />

                      <TableCenter table={t()} dealKey={`${t().handNo}`} />
                    </div>
                  </div>

                  {/* seats — Index (positional): seats frames replace the array
                      on every update; For would remount + replay the deal
                      animation, making every hand "jump" */}
                  <Index each={t().seats}>
                    {(seat) => {
                      // reactive: heroSeat arrives with the join snapshot, so
                      // positions must re-rotate when it lands
                      const pos = () => posFor(seat().seat);
                      const canJoin = () =>
                        t().heroSeat < 0 && !seat().player && store.status === "open";
                      return (
                        <Seat
                          seat={seat()}
                          table={t()}
                          msLeft={msLeftFor(seat().seat)}
                          frac={fracFor(seat().seat)}
                          isHero={seat().seat === t().heroSeat}
                          dealt={t().dealt[seat().seat] ?? 0}
                          dealDx={(0.5 - pos()[0]) * DESIGN_W}
                          dealDy={(0.5 - pos()[1]) * DESIGN_H}
                          landing={t().landingSeat === seat().seat}
                          peeking={seat().seat === t().heroSeat ? heroPeeking() : undefined}
                          onPeekChange={seat().seat === t().heroSeat ? setPeeked : undefined}
                          onJoin={canJoin() ? () => openJoinAt(seat().seat) : undefined}
                          style={`left:${pos()[0] * 100}%; top:${pos()[1] * 100}%`}
                        />
                      );
                    }}
                  </Index>

                  {/* dealer button: glides seat-to-seat around the rail */}
                  <Show when={t().buttonSeat >= 0}>
                    <DealerButton seat={t().buttonSeat} positions={seatPositions()} />
                  </Show>

                  {/* felt chips: player stacks + street bets on the inner ring */}
                  <Index each={t().seats}>
                    {(seat) => {
                      // NB: Index creates each slot once — the empty-seat
                      // guard must live in a <Show>, not an early return,
                      // or chips never appear once someone sits
                      const p = () => posFor(seat().seat);
                      // stack chips: toward the pot but slid LEFT of the
                      // player's card column, so they never cover cards, bets
                      // or the board. double boards hug bets closer to players.
                      // all positions stay reactive: heroSeat arrives with the
                      // join snapshot and the ring must re-rotate then.
                      const spread = () => (t().isDoubleBoard ? 0.62 : 0.5);
                      const stackPos = (): [number, number] => [
                        0.5 + (p()[0] - 0.5) * 0.55 - 56 / DESIGN_W,
                        0.5 + (p()[1] - 0.5) * 0.55,
                      ];
                      const betPos = (): [number, number] => [
                        0.5 + (p()[0] - 0.5) * spread(),
                        0.5 + (p()[1] - 0.5) * spread(),
                      ];
                      return (
                        <Show when={seat().player}>
                          <FeltChips pos={stackPos()} cents={seat().stackCents} />
                          <BetChips pos={betPos()} from={stackPos()} bet={seat().betCents} />
                        </Show>
                      );
                    }}
                  </Index>

                  {/* chips flying to winner */}
                  <For each={winners()}>{(w) => <ChipFly toSeat={posFor(w.seat)} />}</For>
                </div>
              </div>
            </div>
          }
        >
          <div class="h-full w-full">
            <TableMobile
              table={t()}
              joinable={store.status === "open" && t().heroSeat < 0}
              peeking={heroPeeking()}
              onPeekChange={setPeeked}
              onTakeSeat={(s) => (s != null ? openJoinAt(s) : setSpectating(false))}
              msLeftFor={msLeftFor}
              fracFor={fracFor}
            />
          </div>
        </Show>
      </main>

      {/* action bar + feedback (ASPTR-192). Overlaid on the felt's reserved
          bottom margin instead of taking layout space — a height change here
          used to shift/rescale the whole table. */}
      <footer
        ref={footerEl}
        class="absolute inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6"
      >
        <ActionBar
          table={t()}
          send={(a) => store.send(a)}
          error={store.lastError}
          tip={peekTip()}
        />
        <div class="absolute bottom-1 right-3 sm:right-6">
          <FeedbackDialog />
        </div>
      </footer>

      {/* toasts (7-2 bounty gold, rabbit hunt mascot) */}
      <div class="pointer-events-none fixed inset-x-0 top-1 z-40 flex flex-col items-center gap-1.5">
        <For each={store.toasts}>
          {(toast) => (
            <Show
              when={toast.kind === "gold"}
              fallback={
                <Show
                  when={toast.kind === "rabbit"}
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
        texasDropLive={t().texasDrop}
        onArmTexasDrop={() => store.armTexasDrop()}
        cardsOpen={cardsOpen()}
        onSetCardsOpen={setCardPref}
        onClose={() => setDrawerOpen(false)}
      />

      {/* hand-history drawer */}
      <HistoryDrawer
        open={historyOpen()}
        tableId={params.id ?? "dev-table"}
        onClose={() => setHistoryOpen(false)}
      />

      {/* pre-seat modal: name (guests) + buy-in + seat picker */}
      <Show when={joinOpen()} keyed>
        <JoinModal
          open
          seats={t().seats}
          bbCents={t().bbCents}
          me={store.me}
          error={store.lastError}
          initialSeat={presetSeat()}
          onJoin={(seat, name, stack) => store.joinSeat(seat, name, stack)}
          onClose={() => setSpectating(true)}
        />
      </Show>
    </div>
  );
}

/**
 * Flying dealer button: glides seat-to-seat around the rail when the button
 * moves (hand_started carries the new seat; dealing waits for the travel).
 * Positioned in design-box px so it scales with the felt.
 */
function DealerButton(props: { seat: number; positions: [number, number][] }) {
  // eslint-disable-next-line no-unassigned-vars -- Solid ref capture assigns this
  let el!: HTMLDivElement;
  const pos = () => props.positions[props.seat] ?? [0.5, 0.5];
  // parked beside the nameplate: 28px out from the anchor, 88px along the
  // ellipse tangent — clears the plate at every seat angle, overhang included
  const at = ([fx, fy]: [number, number]) => {
    const dx = fx - 0.5;
    const dy = fy - 0.5;
    const len = Math.hypot(dx, dy) || 1;
    const x = fx * DESIGN_W + (dx / len) * 28 - (dy / len) * 88;
    const y = fy * DESIGN_H + (dy / len) * 28 + (dx / len) * 88;
    return `translate(${x}px, ${y}px) translate(-50%, -50%)`;
  };

  createEffect(
    on(
      () => props.seat,
      (seat, prev) => {
        if (prev == null || prev < 0 || prev === seat) return;
        const from = props.positions[prev] ?? [0.5, 0.5];
        const to = pos();
        // bow the midpoint outward so the chip rides the rail, not the pot
        const dx = (from[0] + to[0]) / 2 - 0.5;
        const dy = (from[1] + to[1]) / 2 - 0.5;
        const len = Math.hypot(dx, dy);
        const bow: [number, number] =
          len < 0.04 ? to : [0.5 + (dx / len) * 0.46, 0.5 + (dy / len) * 0.4];
        el.animate([{ transform: at(from) }, { transform: at(bow) }, { transform: at(to) }], {
          duration: BUTTON_TRAVEL_MS,
          easing: "cubic-bezier(0.45, 0, 0.2, 1)",
        });
      },
      { defer: true },
    ),
  );

  return (
    <div
      ref={el}
      class="pointer-events-none absolute left-0 top-0 z-10 grid size-6 place-items-center rounded-full bg-white text-[11px] font-bold text-black shadow-md shadow-black/50"
      style={{ transform: at(pos()) }}
      title="Dealer button"
    >
      D
    </div>
  );
}

/**
 * Player's chip stack on the felt, between the seat and the pot. Pure
 * display: denomination breakdown is approximate at the cap, the exact
 * amount stays on the nameplate.
 */
function FeltChips(props: { pos: [number, number]; cents: number }) {
  return (
    <Show when={props.cents > 0}>
      <div
        class="pointer-events-none absolute z-[5] -translate-x-1/2 -translate-y-1/2"
        style={{ left: `${props.pos[0] * 100}%`, top: `${props.pos[1] * 100}%` }}
      >
        <ChipStack cents={props.cents} size={20} maxColumns={4} />
      </div>
    </Show>
  );
}

let betFlightId = 0;

/** Street bet on the inner ring: chips + exact amount; a chip flies in from
 * the player's stack whenever the bet grows (bet, raise, blind post). */
function BetChips(props: { pos: [number, number]; from: [number, number]; bet: number }) {
  const [flights, setFlights] = createSignal<number[]>([]);
  createEffect(
    on(
      () => props.bet,
      (b, prev) => {
        if (prev == null || b <= prev) return;
        const id = ++betFlightId;
        setFlights((f) => [...f, id]);
        setTimeout(() => setFlights((f) => f.filter((x) => x !== id)), 650);
      },
      { defer: true },
    ),
  );
  const dx = () => `${(props.pos[0] - props.from[0]) * DESIGN_W}px`;
  const dy = () => `${(props.pos[1] - props.from[1]) * DESIGN_H}px`;
  return (
    <Show when={props.bet > 0}>
      <div
        class="pointer-events-none absolute z-[6] flex flex-col items-center gap-0.5"
        style={{
          left: `${props.pos[0] * 100}%`,
          top: `${props.pos[1] * 100}%`,
          transform: "translate(-50%, -50%)",
        }}
      >
        <ChipStack cents={props.bet} size={18} maxColumns={3} />
        <span class="rounded bg-black/50 px-1.5 text-[11px] font-bold tabular-nums text-white/95 shadow">
          {money(props.bet)}
        </span>
      </div>
      <For each={flights()}>
        {() => (
          <span
            class="animate-bet-fly pointer-events-none absolute z-[7]"
            style={{
              left: `${props.from[0] * 100}%`,
              top: `${props.from[1] * 100}%`,
              "--bet-x": dx(),
              "--bet-y": dy(),
            }}
          >
            <span
              class="block rounded-[50%]"
              style={{
                width: "20px",
                height: "7px",
                background:
                  "repeating-linear-gradient(90deg, rgba(255,255,255,0.9) 0 2px, transparent 2px 5px), #f64932",
                "box-shadow":
                  "inset 0 1.5px 0 rgba(255,255,255,0.55), inset 0 -1.5px 0 rgba(0,0,0,0.45)",
              }}
            />
          </span>
        )}
      </For>
    </Show>
  );
}

/** Pot → winner chip burst. Origin = felt center; target = seat position. */
function ChipFly(props: { toSeat: [number, number] }) {
  // eslint-disable-next-line no-unassigned-vars -- Solid ref capture assigns this
  let host: HTMLDivElement | undefined;
  const [vars, setVars] = createSignal<Record<string, string>>({});
  onMount(() => {
    // host fills the felt box; target offset = seat fraction − center
    const w = host?.parentElement?.clientWidth ?? 0;
    const h = host?.parentElement?.clientHeight ?? 0;
    setVars({
      "--chip-x": `${props.toSeat[0] * w - w / 2}px`,
      "--chip-y": `${props.toSeat[1] * h - h / 2}px`,
    });
  });
  return (
    <div ref={host} class="pointer-events-none absolute inset-0 grid place-items-center">
      <div class="relative">
        <For each={[0, 1, 2, 3, 4, 5]}>
          {(_, i) => (
            <span
              class="chip chip-fly absolute"
              style={{ ...vars(), "animation-delay": `${i() * 70}ms` }}
            />
          )}
        </For>
      </div>
    </div>
  );
}
