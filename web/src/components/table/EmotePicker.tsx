import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { cn } from "../../lib/cn";

/** Curated grid — keeps taps one-click and the wire payload tiny. */
export const EMOTES = [
  "😂",
  "😅",
  "😍",
  "😎",
  "🥵",
  "😭",
  "😤",
  "🤯",
  "🫠",
  "🤑",
  "😈",
  "💀",
  "🍀",
  "🔥",
  "💪",
  "👀",
  "🙏",
  "👏",
  "🍻",
  "🫡",
  "🐐",
  "🐔",
  "🃏",
  "💩",
];

/**
 * Header emote picker. Two modes: "fly" sends one emoji across every
 * screen at the table; "tag" pins it next to your name on the nameplate.
 */
export function EmotePicker(props: {
  /** hero's current profile tag ("" = none) */
  tag: string;
  onEmote: (emoji: string) => void;
  onSetTag: (emoji: string) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [mode, setMode] = createSignal<"fly" | "tag">("fly");
  // eslint-disable-next-line no-unassigned-vars -- Solid ref capture assigns this
  let host: HTMLDivElement | undefined;

  const closeOnOutside = (e: PointerEvent) => {
    if (open() && host && !host.contains(e.target as Node)) setOpen(false);
  };
  onMount(() => window.addEventListener("pointerdown", closeOnOutside));
  onCleanup(() => window.removeEventListener("pointerdown", closeOnOutside));

  const tap = (emoji: string) => {
    if (mode() === "fly") {
      props.onEmote(emoji);
      setOpen(false);
    } else {
      props.onSetTag(emoji);
    }
  };

  return (
    <div ref={host} class="relative">
      <button
        type="button"
        title="Emotes"
        aria-label="Emotes"
        aria-expanded={open()}
        class="grid size-7 place-items-center rounded-lg text-base leading-none text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg"
        onClick={() => setOpen((v) => !v)}
      >
        🙂
      </button>
      <Show when={open()}>
        <div
          class="animate-in-menu absolute right-0 top-full z-50 mt-2 w-64 rounded-2xl border border-line bg-surface/95 p-3 shadow-2xl shadow-black/50 backdrop-blur"
          role="dialog"
          aria-label="Emotes"
        >
          <div class="mb-2 flex gap-1 rounded-lg bg-surface-raised/60 p-0.5 text-[11px] font-semibold">
            <button
              type="button"
              class={cn(
                "flex-1 rounded-md px-2 py-1 transition-colors",
                mode() === "fly" ? "bg-surface text-accent" : "text-fg-muted hover:text-fg",
              )}
              onClick={() => setMode("fly")}
            >
              fly across table
            </button>
            <button
              type="button"
              class={cn(
                "flex-1 rounded-md px-2 py-1 transition-colors",
                mode() === "tag" ? "bg-surface text-accent" : "text-fg-muted hover:text-fg",
              )}
              onClick={() => setMode("tag")}
            >
              pin to my name
            </button>
          </div>
          <div class="grid grid-cols-6 gap-0.5">
            <For each={EMOTES}>
              {(e) => (
                <button
                  type="button"
                  class="rounded-lg py-1 text-xl transition-transform hover:scale-125"
                  onClick={() => tap(e)}
                >
                  {e}
                </button>
              )}
            </For>
          </div>
          <Show when={mode() === "tag"}>
            <div class="mt-2 flex items-center justify-between border-t border-line/60 pt-2 text-[11px] text-fg-muted">
              <span>
                current tag: <span class="text-base">{props.tag || "—"}</span>
              </span>
              <Show when={props.tag}>
                <button
                  type="button"
                  class="font-semibold text-danger hover:underline"
                  onClick={() => props.onSetTag("")}
                >
                  clear
                </button>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
