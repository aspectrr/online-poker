import { createSignal, For, Show } from "solid-js";
import { A } from "@solidjs/router";
import { Button } from "../ui/Button";
import { Dialog, DialogContent } from "../ui/Dialog";
import { Field } from "../ui/Select";
import { Input } from "../ui/Input";
import { money } from "../../lib/money";
import type { SeatState } from "../../lib/protocol";
import { cn } from "../../lib/cn";

/**
 * Pre-seat modal: guests pick a display name; everyone picks a buy-in (bb)
 * and a seat. Signed-in users skip the name field (they play as their
 * account name). Dismissing just watches — empty seats stay clickable.
 */
export function JoinModal(props: {
  open: boolean;
  seats: SeatState[];
  bbCents: number;
  me: { name: string; isGuest: boolean } | null;
  error: string | null;
  initialSeat?: number;
  onJoin: (seat: number, name: string, stackCents: number) => void;
  onClose: () => void;
}) {
  const [name, setName] = createSignal("");
  const [stackBb, setStackBb] = createSignal(100);
  const [seat, setSeat] = createSignal<number | null>(props.initialSeat ?? null);

  const openSeat = () => props.seats.find((s) => !s.player)?.seat ?? null;
  const chosen = () => seat() ?? openSeat();
  const displayName = () => (props.me?.isGuest ? name() : (props.me?.name ?? ""));
  const valid = () =>
    chosen() != null && (props.me && !props.me.isGuest ? true : displayName().trim().length > 0);

  const submit = (e: SubmitEvent) => {
    e.preventDefault();
    if (chosen() == null || !valid()) return;
    props.onJoin(chosen()!, displayName().trim(), Math.round(stackBb() * props.bbCents));
  };

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent
        title="Take a seat"
        description={props.me && !props.me.isGuest ? undefined : "Pick a name, buy-in, and seat."}
      >
        <form class="flex flex-col gap-6" onSubmit={submit}>
          <Show
            when={props.me && !props.me.isGuest}
            fallback={
              <Field label="Your name">
                <Input
                  required
                  maxlength={24}
                  autocomplete="off"
                  placeholder="e.g. RiverRat42"
                  value={name()}
                  onInput={(e) => setName(e.currentTarget.value)}
                />
              </Field>
            }
          >
            <p class="text-sm text-fg-muted">
              Playing as <span class="font-semibold text-fg">{props.me?.name}</span>
            </p>
          </Show>

          <Field
            label="Buy-in"
            hint={`= ${money(stackBb() * props.bbCents)} at ${money(props.bbCents)}/bb`}
          >
            <div class="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                step={1}
                required
                class="w-28"
                value={stackBb()}
                onInput={(e) => {
                  const n = Math.round(Number(e.currentTarget.value));
                  if (n > 0) setStackBb(n);
                }}
              />
              <span class="text-sm font-semibold text-fg-muted">bb</span>
              <div class="ml-auto flex gap-1.5">
                <For each={[50, 100, 200]}>
                  {(bb) => (
                    <button
                      type="button"
                      onClick={() => setStackBb(bb)}
                      class={cn(
                        "rounded-lg border px-2.5 py-1 text-xs font-semibold tabular-nums transition-colors",
                        stackBb() === bb
                          ? "border-accent bg-accent/20 text-accent"
                          : "border-line bg-surface-raised text-fg-muted hover:border-accent/40 hover:text-fg",
                      )}
                    >
                      {bb}
                    </button>
                  )}
                </For>
              </div>
            </div>
          </Field>

          <Field label="Seat">
            <div class="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Seat">
              <For each={props.seats}>
                {(s) => {
                  const taken = () => s.player !== "";
                  const selected = () => chosen() === s.seat;
                  return (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selected()}
                      disabled={taken()}
                      onClick={() => setSeat(s.seat)}
                      class={cn(
                        "size-10 rounded-lg border text-sm font-bold tabular-nums transition-colors",
                        taken()
                          ? "cursor-not-allowed border-line/50 bg-bg/40 text-fg-muted/40 line-through"
                          : selected()
                            ? "border-accent bg-accent text-accent-fg"
                            : "border-line bg-surface-raised text-fg-muted hover:border-accent/40 hover:text-fg",
                      )}
                    >
                      {s.seat + 1}
                    </button>
                  );
                }}
              </For>
            </div>
          </Field>

          <Show when={props.error}>
            <p class="rounded-lg bg-danger/15 px-3 py-1.5 text-xs font-medium text-danger">
              {props.error}
            </p>
          </Show>

          <Show when={props.me?.isGuest}>
            <p class="text-xs text-fg-muted">
              <A href="/auth" class="font-semibold text-accent hover:underline">
                Sign in
              </A>{" "}
              to save this session's hands and track your results across tables.
            </p>
          </Show>

          <div class="flex items-center justify-end gap-3 border-t border-line pt-4">
            <Button type="button" variant="ghost" onClick={() => props.onClose()}>
              Just watching
            </Button>
            <Button type="submit" disabled={!valid()}>
              Take seat {chosen() != null ? chosen()! + 1 : ""}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
