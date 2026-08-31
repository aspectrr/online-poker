import { For, Show, createMemo } from "solid-js";
import { money } from "../../lib/money";
import type { SeatState, TableState } from "../../lib/tableTypes";
import { CardRow } from "../cards/CardRow";
import { Card } from "../cards/Card";
import { ChipStack } from "./ChipStack";
import { cn } from "../../lib/cn";

/** Countdown ring color shifts to danger under 5s. */
function ringColor(msLeft: number | null): string {
  if (msLeft == null) return "var(--accent)";
  return msLeft < 5000 ? "var(--danger)" : "var(--accent)";
}

export function Seat(props: {
  seat: SeatState;
  table: TableState;
  /** ms left on this seat's clock, null when not acting */
  msLeft: number | null;
  /** fraction of timeout remaining 0..1 */
  frac: number;
  isHero: boolean;
  /** cards landed for this seat so far in the opening-deal sequence */
  dealt: number;
  /** px offset from felt center — deal animation flight origin */
  dealDx: number;
  dealDy: number;
  /** first-to-act landing pulse right after the opening deal */
  landing?: boolean;
  /** present when a spectator may take this empty seat */
  onJoin?: () => void;
  class?: string;
  style?: string;
}) {
  const s = () => props.seat;
  const t = () => props.table;
  const acting = () => t().toAct === s().seat;
  const empty = () => !s().player;
  const total = () => t().dealTotal;
  const landed = () => Math.min(props.dealt, total());
  const dealVars = () => ({ "--deal-dx": `${props.dealDx}px`, "--deal-dy": `${props.dealDy}px` });

  // hero hole cards: stable card refs (memo), landed count gates visibility
  const heroHand = createMemo(() =>
    props.isHero && t().holeCards[0] ? t().holeCards[0].map((c) => ({ ...c })) : null,
  );
  const heroShown = () => (heroHand() ? heroHand()!.slice(0, landed()) : null);
  // showdown reveal: villains' cards go face-up
  const revealed = () => {
    const cards = s().revealedCards;
    return !props.isHero && cards?.length ? cards.map((c) => ({ ...c })) : null;
  };

  return (
    <div
      class={cn(
        "absolute flex w-36 flex-col items-center gap-1.5 -translate-x-1/2 -translate-y-1/2",
        props.class,
      )}
      style={props.style}
    >
      {/* cards sit above the nameplate */}
      <Show when={!empty()}>
        <div class="flex -space-x-4">
          <Show
            when={heroShown()}
            fallback={
              <Show
                when={revealed()}
                fallback={
                  // face-down backs, dealt one per beat: fly in from the deck
                  <div class="flex -space-x-6" style={dealVars()}>
                    <For each={Array.from({ length: landed() }, (_, i) => i)}>
                      {() => (
                        <div class="animate-deal-seat">
                          <Card faceDown size="sm" />
                        </div>
                      )}
                    </For>
                  </div>
                }
              >
                <CardRow cards={revealed()!} size="sm" revealed />
              </Show>
            }
          >
            <div class="flex -space-x-6" style={dealVars()}>
              <For each={heroShown()!}>
                {(card, i) => (
                  <div class="animate-deal-seat">
                    <CardRow
                      cards={[card]}
                      size="sm"
                      revealed={props.table.dealDone || landed() > i() + 1}
                    />
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>

      <Show when={!empty()}>
        <div class="relative flex items-end gap-1">
          {/* chip tower: relative stack size (log scale, capped) */}
          <ChipStack
            stack={s().stackCents}
            unit={Math.max(1, t().bbCents)}
            size={12}
            class="mb-0.5 origin-bottom"
          />
          <div
            class={cn(
              "relative w-full rounded-xl border px-2.5 py-1.5 backdrop-blur-sm transition-shadow duration-300",
              "bg-surface/90 shadow-lg shadow-black/40",
              acting() ? "border-accent/70" : "border-line/80",
              s().folded && "opacity-55 saturate-50",
              s().sittingOut && "opacity-60",
              s().isWinner && "border-success/80",
            )}
            classList={{
              "ring-2 ring-accent/60 shadow-[0_0_24px_rgba(212,175,55,0.35)] animate-[glow_1.6s_ease-in-out_infinite]":
                acting(),
              "animate-landing": !!props.landing,
            }}
          >
            {/* timer arc: svg circle around the nameplate */}
            <Show when={acting()}>
              <svg
                class="pointer-events-none absolute -inset-1.5"
                viewBox="0 0 100 54"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <rect
                  x="1.5"
                  y="1.5"
                  width="97"
                  height="51"
                  rx="10"
                  fill="none"
                  stroke={ringColor(props.msLeft)}
                  stroke-width="3"
                  stroke-linecap="round"
                  stroke-dasharray={`${props.frac * 280} 280`}
                />
              </svg>
            </Show>

            <div class="flex items-center justify-between gap-2">
              <span
                class={cn(
                  "truncate text-[13px] font-semibold",
                  props.isHero ? "text-accent" : "text-fg",
                )}
              >
                {props.isHero ? "you" : s().player}
              </span>
            </div>
            <div class="flex items-baseline justify-between gap-2">
              <span class="text-[13px] font-bold tabular-nums text-fg">
                {money(s().stackCents)}
              </span>
              <span
                class={cn(
                  "h-4 truncate text-right text-[11px] font-medium",
                  s().lastAction?.startsWith("Raise") || s().lastAction?.startsWith("Bet")
                    ? "text-accent"
                    : "text-fg-muted",
                )}
              >
                {s().lastAction}
              </span>
            </div>
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
        <Show
          when={props.onJoin}
          fallback={
            <div class="w-full rounded-xl border border-dashed border-line/70 bg-black/20 px-2.5 py-2.5 text-center text-[11px] text-fg-muted">
              empty seat
            </div>
          }
        >
          <button
            type="button"
            class="w-full rounded-xl border border-dashed border-accent/50 bg-black/20 px-2.5 py-2.5 text-center text-[11px] font-semibold text-accent transition-colors hover:bg-accent/10"
            onClick={() => props.onJoin?.()}
          >
            sit here
          </button>
        </Show>
      </Show>
    </div>
  );
}
