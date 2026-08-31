import { For, Show, createMemo } from "solid-js";
import { chipColor, columns } from "../../lib/chips";
import { cn } from "../../lib/cn";

/**
 * Side-view chip stacks broken into denominations (lib/chips): largest
 * chips leftmost, ≤ 8 chips per column, columns capped. Callers render the
 * exact amount separately — the stacks are the visual, not the number.
 */
export function ChipStack(props: {
  cents: number;
  /** chip diameter px */
  size?: number;
  maxColumns?: number;
  class?: string;
}) {
  const size = () => props.size ?? 22;
  const h = () => Math.max(5, Math.round(size() * 0.32));
  const cols = createMemo(() => columns(Math.round(props.cents), 8, props.maxColumns ?? 4));
  return (
    <Show when={cols().length > 0}>
      <div
        class={cn("flex items-end gap-1", props.class)}
        role="img"
        aria-label={`chip stacks worth ${props.cents} cents`}
      >
        <For each={cols()}>
          {(col) => (
            <div class="flex flex-col items-center">
              <For each={col}>
                {(denom, i) => (
                  <span
                    class="block rounded-[50%]"
                    style={{
                      width: `${size()}px`,
                      height: `${h()}px`,
                      "margin-top": i() === 0 ? "0" : `${-h() * 0.42}px`,
                      background: `repeating-linear-gradient(90deg, rgba(255,255,255,0.85) 0 2px, transparent 2px 6px), ${chipColor(denom)}`,
                      "box-shadow":
                        "inset 0 1px 0 rgba(255,255,255,0.45), inset 0 -1px 0 rgba(0,0,0,0.5)",
                      border: "0.5px solid rgba(0,0,0,0.4)",
                      "z-index": col.length - i(),
                    }}
                  />
                )}
              </For>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}
