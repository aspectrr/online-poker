import { For, Show, splitProps } from "solid-js";
import type { UICard } from "../../lib/protocol";
import { CardRow } from "./CardRow";
import { Card } from "./Card";
import { cn } from "../../lib/cn";

/**
 * Hero hole cards with the hold-to-peek interaction (cards stay face-down
 * until held — mimics protecting your hand). Shared by the desktop felt
 * Seat and the compact mobile layout so peek behaves identically everywhere.
 */
export function HeroHand(props: {
  cards: UICard[];
  /** cards per player this hand (2, or 4 in a bomb pot) — every slot is
   *  reserved up front so a newly-landed card never shifts the others */
  total?: number;
  /** true once the hand is over (showdown) — cards show face-up without peeking */
  revealed: boolean;
  /** false renders a static hand (no interaction) */
  interactive: boolean;
  peeking?: boolean;
  onPeekChange?: (peeking: boolean) => void;
  /** px offset from felt center — deal animation flight origin (0 on mobile) */
  dealDx?: number;
  dealDy?: number;
  class?: string;
}) {
  const dealVars = () => ({
    "--deal-dx": `${props.dealDx ?? 0}px`,
    "--deal-dy": `${props.dealDy ?? 0}px`,
  });

  const [local] = splitProps(props, ["cards", "total", "revealed"]);

  return (
    <div
      role="button"
      tabindex={props.interactive ? 0 : undefined}
      aria-pressed={props.interactive ? !!props.peeking : undefined}
      aria-label={props.interactive ? "Hold to peek at your cards" : "your hole cards"}
      class={cn(
        "flex -space-x-6 select-none",
        props.interactive &&
          "cursor-pointer touch-none rounded-lg focus-visible:outline-2 focus-visible:outline-accent",
        props.peeking && "animate-peek",
      )}
      style={dealVars()}
      onPointerDown={(e) => {
        if (props.interactive) {
          e.preventDefault();
          props.onPeekChange!(true);
        }
      }}
      onPointerUp={() => props.onPeekChange?.(false)}
      onPointerLeave={() => props.onPeekChange?.(false)}
      onPointerCancel={() => props.onPeekChange?.(false)}
      onContextMenu={(e) => props.interactive && e.preventDefault()}
      onKeyDown={(e) => {
        if (props.interactive && (e.key === " " || e.key === "Enter")) {
          e.preventDefault();
          props.onPeekChange!(true);
        }
      }}
      onKeyUp={() => props.onPeekChange?.(false)}
    >
      <For each={Array.from({ length: Math.max(local.total ?? 0, local.cards.length) })}>
        {(_, i) => (
          <div class={cn("h-20 w-14", i() < local.cards.length && "animate-deal-seat")}>
            <Show when={local.cards[i()]} fallback={<Card faceDown size="sm" class="opacity-0" />}>
              <CardRow cards={[local.cards[i()]]} size="sm" revealed={local.revealed} />
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}
