import { For, Show } from "solid-js";
import { cn } from "../../lib/cn";

/**
 * Flat accent-hue chip tower (DESIGN.md: flat accent fills). Chip count
 * scales log-ish with `stack` relative to `unit` (usually the big blind),
 * capped — stack proportionality visible at a glance.
 */
const HUES = ["#0075de", "#ffb110", "#f64932", "#62aef0", "#02093a"];

/** chips for a stack: 1 chip at 1 unit, +1 per doubling, capped at max. */
export function chipCount(stack: number, unit: number, max = 8): number {
  if (unit <= 0 || stack <= 0) return 0;
  return Math.min(max, 1 + Math.floor(Math.log2(stack / unit) + 1e-4));
}

export function ChipStack(props: {
  stack: number;
  /** value of one chip for the log scale (usually the big blind) */
  unit: number;
  max?: number;
  /** chip diameter px */
  size?: number;
  class?: string;
}) {
  const count = () => chipCount(props.stack, props.unit, props.max ?? 8);
  const size = () => props.size ?? 13;
  return (
    <Show when={count() > 0}>
      <div
        class={cn("flex flex-col items-center", props.class)}
        role="img"
        aria-label={`chip stack: ${count()} chips`}
      >
        <For each={Array.from({ length: count() })}>
          {(_, i) => (
            <span
              class="block rounded-full border border-black/25 shadow-[inset_0_-2px_0_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.35)]"
              style={{
                width: `${size()}px`,
                height: `${size()}px`,
                "margin-top": i() === 0 ? "0" : `${-size() * 0.62}px`,
                background: HUES[i() % HUES.length],
                "z-index": i(),
              }}
            />
          )}
        </For>
      </div>
    </Show>
  );
}
