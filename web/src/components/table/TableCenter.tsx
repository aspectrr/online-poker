import { For, Index, Show } from "solid-js";
import { money } from "../../lib/money";
import type { TableState } from "../../lib/tableTypes";
import { CardRow, dealDelay } from "../cards/CardRow";
import { ChipStack } from "./ChipStack";
import { cn } from "../../lib/cn";

/**
 * Pot + board in the felt center. Double boards render two labeled rows:
 * bomb pot = A/B, run-it-twice = Run 1/Run 2 — each with a half-pot
 * indicator and a win ring when that board's pot was awarded. Board cards
 * are keyed by object identity in the store, so only NEW cards animate.
 */
export function TableCenter(props: { table: TableState; dealKey: string; class?: string }) {
  const t = () => props.table;
  const boards = () => t().board.boards;
  const isDouble = () => boards().length > 1;
  const label = (row: number) =>
    t().bombPot ? `board ${String.fromCharCode(65 + row)}` : `run ${row + 1}`;
  const halfPot = () => Math.round(t().potCents / 2);

  return (
    <div
      class={cn(
        "pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3",
        props.class,
      )}
    >
      {/* pot: chip stack scales with size */}
      <Show when={t().potCents > 0 || boards()[0].length > 0}>
        <div class="flex items-center gap-2 rounded-full border border-accent/25 bg-black/35 px-3.5 py-1 shadow-lg shadow-black/30 backdrop-blur-[2px]">
          <ChipStack cents={t().potCents} size={15} maxColumns={5} class="items-center" />
          <span class="text-sm font-bold tabular-nums text-accent">{money(t().potCents)}</span>
          <span class="text-[10px] font-semibold uppercase tracking-widest text-fg-muted">pot</span>
        </div>
      </Show>

      {/* board rows: Index keys rows by position so dealt card nodes persist
            across streets (only NEW cards mount + animate) */}
      <Index each={boards()}>
        {(cards, row) => (
          <div
            class={cn(
              "flex flex-col items-center gap-1 rounded-xl px-2 py-1",
              t().isDoubleBoard &&
                t().boardWins.includes(row) &&
                "animate-board-win ring-2 ring-success/80",
            )}
          >
            <Show when={isDouble()}>
              <span
                class={cn(
                  "flex items-center gap-2 rounded bg-black/40 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                  t().boardWins.includes(row) ? "text-success" : "text-fg-muted",
                )}
              >
                {label(row)}
                <Show when={t().potCents > 0}>
                  <span class="font-semibold tabular-nums normal-case text-accent/90">
                    ½ {money(halfPot())}
                  </span>
                </Show>
              </span>
            </Show>
            <div class="flex items-center gap-1.5">
              {/* dealt cards: keyed by card identity — only new ones mount+animate */}
              <For each={cards()}>
                {(card, i) => (
                  <div class="animate-deal" style={dealDelay(i(), 110)}>
                    <CardRow
                      cards={[card]}
                      size="sm"
                      revealed
                      class={cn(
                        "shadow-lg shadow-black/40",
                        card.rabbit && "opacity-55 -rotate-6 saturate-50",
                      )}
                    />
                  </div>
                )}
              </For>
              {/* remaining empty slots */}
              <For each={slotsAfter(cards())}>
                {() => (
                  <div class="h-20 w-14 rounded-lg border-2 border-dashed border-white/12 bg-black/15" />
                )}
              </For>
            </div>
          </div>
        )}
      </Index>

      {/* status line */}
      <div class="mt-1 h-5 text-xs font-medium text-fg-muted">{t().message}</div>
    </div>
  );
}

/** 5-total slots: placeholder count after `cards` (min 0). */
function slotsAfter(cards: unknown[]): unknown[] {
  return Array.from({ length: Math.max(0, 5 - cards.length) });
}
