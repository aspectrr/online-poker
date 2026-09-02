import { For, Show, createMemo } from "solid-js";
import { money } from "../../lib/money";
import type { SeatState, TableState } from "../../lib/tableTypes";
import { TableCenter } from "./TableCenter";
import { HeroHand } from "../cards/HeroHand";
import { Card } from "../cards/Card";
import { cn } from "../../lib/cn";

/**
 * Compact table layout for phones (narrow or short viewports). The desktop
 * felt is a 1024px design box — scaled to a phone its text is unreadable, so
 * phones get native-size components instead: opponents as chips on top, a
 * felt-styled panel with pot + board in the middle, hero cards + action bar
 * at the bottom. Hold-to-peek behaves exactly like the felt (shared HeroHand).
 */
export function TableMobile(props: {
  table: TableState;
  /** spectator may take a seat */
  joinable: boolean;
  peeking: boolean;
  onPeekChange: (peeking: boolean) => void;
  /** open the join modal (optionally presetting a seat) */
  onTakeSeat: (seat?: number) => void;
  msLeftFor: (seat: number) => number | null;
  fracFor: (seat: number) => number;
}) {
  const t = () => props.table;
  const opponents = () => t().seats.filter((s) => s.player && s.seat !== t().heroSeat);
  const hero = () => t().seats[t().heroSeat];
  const handOver = () => t().street === "showdown" || t().street === "complete";
  const heroCards = createMemo(() => t().holeCards[0] ?? null);
  const heroDealt = () => Math.min(t().dealt[t().heroSeat] ?? 0, heroCards()?.length ?? 0);

  return (
    <div class="flex h-full min-h-0 flex-col gap-2">
      {/* opponents: wrapped chips in portrait, one scrollable strip when short */}
      <div class="no-scrollbar flex flex-wrap items-stretch justify-center gap-1.5 [@media(max-height:559px)]:flex-nowrap [@media(max-height:559px)]:justify-start [@media(max-height:559px)]:overflow-x-auto [@media(max-height:559px)]:pr-1">
        <For each={opponents()}>
          {(s) => (
            <OpponentChip
              table={t()}
              seat={s}
              msLeft={props.msLeftFor(s.seat)}
              frac={props.fracFor(s.seat)}
              cardsPerPlayer={t().dealTotal}
            />
          )}
        </For>
      </div>

      {/* board panel — felt-styled, pot + community cards via shared TableCenter */}
      <div
        class="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-[#3a2b1d] shadow-[inset_0_0_40px_rgba(0,0,0,0.55)]"
        style="background: radial-gradient(ellipse 90% 80% at 50% 40%, #1f6f4a 0%, #175a3c 50%, #0f4530 100%)"
      >
        <div class="absolute inset-[6%] rounded-[inherit] border border-white/10" />
        {/* shrink board content on short screens; top-anchor so the hero overlay keeps it clear */}
        <div class="absolute inset-0 [@media(max-height:559px)]:scale-[0.6] [@media(min-height:560px)_and_(max-height:699px)]:scale-[0.85]">
          <TableCenter
            table={t()}
            dealKey={`${t().handNo}`}
            class="[@media(max-height:559px)]:justify-start [@media(max-height:559px)]:pt-2"
          />
        </div>
      </div>

      {/* hero zone: cards (hold to peek) + plate, or take-a-seat CTA */}
      <Show
        when={hero()}
        fallback={
          <Show when={props.joinable}>
            <button
              type="button"
              class="mx-auto rounded-xl border border-dashed border-accent/50 bg-accent-tint/60 px-8 py-3 text-sm font-semibold text-accent"
              onClick={() => props.onTakeSeat()}
            >
              Take a seat
            </button>
          </Show>
        }
      >
        {(h) => (
          <div class="flex items-center justify-center gap-3 [@media(max-height:559px)]:absolute [@media(max-height:559px)]:bottom-1.5 [@media(max-height:559px)]:right-2 [@media(max-height:559px)]:z-10 [@media(max-height:559px)]:items-end">
            <Show when={heroCards()}>
              <div class="relative">
                <HeroHand
                  cards={heroCards()!.slice(0, heroDealt())}
                  total={t().dealTotal}
                  revealed={!!props.peeking || handOver()}
                  interactive
                  peeking={props.peeking}
                  onPeekChange={props.onPeekChange}
                />
                <Show when={!props.peeking && !handOver() && heroDealt() > 0}>
                  <span class="pointer-events-none absolute -bottom-5 left-1/2 -translate-x-1/2 text-[10px] font-medium text-fg-faint [@media(max-height:559px)]:hidden">
                    hold to peek
                  </span>
                </Show>
              </div>
            </Show>
            <div
              class={cn(
                "min-w-28 rounded-xl border bg-surface/90 px-2.5 py-1.5 shadow-sm backdrop-blur-sm",
                t().toAct === t().heroSeat
                  ? "border-accent/70 ring-2 ring-accent/60"
                  : "border-line/80",
                h().isWinner && "border-marigold bg-marigold/90",
              )}
            >
              <div class="text-[13px] font-semibold text-accent">you</div>
              <div class="flex items-baseline gap-2">
                <span class="text-[13px] font-bold tabular-nums">{money(h().stackCents)}</span>
                <Show when={h().betCents > 0}>
                  <span class="text-[11px] font-semibold tabular-nums text-accent">
                    bet {money(h().betCents)}
                  </span>
                </Show>
              </div>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}

/** Compact opponent plate: mini cards (backs → revealed faces at showdown),
 *  name + dealer badge, stack, last action, street bet, acting timer bar. */
function OpponentChip(props: {
  table: TableState;
  seat: SeatState;
  msLeft: number | null;
  frac: number;
  cardsPerPlayer: number;
}) {
  const s = () => props.seat;
  const acting = () => props.table.toAct === s().seat;
  const isButton = () => props.table.buttonSeat === s().seat;
  const backs = () => Array.from({ length: props.cardsPerPlayer }, (_, i) => i);

  return (
    <div
      class={cn(
        "relative w-30 shrink-0 overflow-hidden rounded-xl border bg-surface/90 px-2 pt-1.5 pb-1 backdrop-blur-sm",
        acting() ? "border-accent/70" : "border-line/80",
        s().folded && "opacity-55 saturate-50",
        s().sittingOut && "opacity-60",
        s().isWinner && "border-marigold",
      )}
    >
      {/* cards: revealed faces at showdown, else card backs while in hand */}
      <div class="flex h-11 items-center justify-center gap-1">
        <Show
          when={s().revealedCards?.length}
          fallback={
            <Show when={s().hasCards}>
              <div class="flex -space-x-3">
                <For each={backs()}>
                  {() => <Card faceDown size="sm" class="h-10 w-7 rounded-md" />}
                </For>
              </div>
            </Show>
          }
        >
          <div class="flex -space-x-3">
            <For each={s().revealedCards!}>
              {(c) => <Card rank={c.rank} suit={c.suit} size="sm" class="h-10 w-7 rounded-md" />}
            </For>
          </div>
        </Show>
      </div>

      <div class="mt-0.5 flex items-center gap-1">
        <span class="truncate text-[11px] font-semibold text-fg">{s().player}</span>
        <Show when={isButton()}>
          <span class="grid size-3.5 shrink-0 place-items-center rounded-full bg-white text-[8px] font-bold text-black shadow">
            D
          </span>
        </Show>
        <span class="ml-auto shrink-0 text-[11px] font-bold tabular-nums">
          {money(s().stackCents)}
        </span>
      </div>
      <div class="flex h-3.5 items-center justify-between gap-1">
        <Show when={s().betCents > 0}>
          <span class="truncate text-[10px] font-semibold tabular-nums text-accent">
            {money(s().betCents)}
          </span>
        </Show>
        <Show when={props.table.equities && props.table.equities[s().seat] != null}>
          <span class="rounded bg-black/60 px-1 text-[9px] font-bold tabular-nums text-white">
            {props.table.equities![s().seat]}%
          </span>
        </Show>
        <Show when={s().lastAction}>
          <span
            class={cn(
              "ml-auto truncate text-[10px] font-medium",
              s().lastAction?.startsWith("Raise") || s().lastAction?.startsWith("Bet")
                ? "text-accent"
                : "text-fg-muted",
            )}
          >
            {s().lastAction}
          </span>
        </Show>
      </div>

      {/* acting: timer bar along the bottom edge */}
      <Show when={acting()}>
        <div class="absolute inset-x-0 bottom-0 h-[3px] bg-black/10">
          <div
            class="h-full transition-[width] duration-250 ease-linear"
            classList={{
              "bg-danger": (props.msLeft ?? Infinity) < 5000,
              "bg-accent": (props.msLeft ?? Infinity) >= 5000,
            }}
            style={{ width: `${Math.round(props.frac * 100)}%` }}
          />
        </div>
      </Show>
    </div>
  );
}
