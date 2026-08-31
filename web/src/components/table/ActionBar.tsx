import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { parseBetToCents, raisePresets, raiseStepCents, type PresetCtx } from "../../lib/betting";
import { money } from "../../lib/money";
import type { PlayerAction, Street, TableState } from "../../lib/tableTypes";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Slider } from "../ui/Slider";
import { cn } from "../../lib/cn";

/**
 * Bottom action bar. Raise semantics are raise-TO cents throughout.
 * Keyboard: F fold · C check/call · R focus raise · ←/→ step · Enter confirm · Esc cancel.
 */
export function ActionBar(props: {
  table: TableState;
  send: (a: PlayerAction) => void;
  error: string | null;
}) {
  const t = () => props.table;
  const legal = () => t().legal;
  const active = () => legal() != null && t().toAct === t().heroSeat;

  const [raiseTo, setRaiseTo] = createSignal(0);
  const [raising, setRaising] = createSignal(false);
  const [typed, setTyped] = createSignal("");
  const [typing, setTyping] = createSignal(false);
  const [inputEl, setInputEl] = createSignal<HTMLInputElement | null>(null);

  const potTotal = () => t().potCents; // contract: pot includes current street bets
  const streetBet = () => Math.max(0, ...t().seats.map((s) => s.betCents));
  const heroBet = () => t().seats[t().heroSeat]?.betCents ?? 0;

  const ctx = createMemo<PresetCtx | null>(() => {
    const la = legal();
    if (!la) return null;
    return {
      street: t().street as Street,
      potCents: potTotal(),
      streetBetCents: streetBet(),
      heroBetCents: heroBet(),
      callCents: la.callCents,
      sbCents: t().sbCents,
      bbCents: t().bbCents,
      minRaiseToCents: la.minRaiseToCents,
      maxRaiseToCents: la.maxRaiseToCents,
    };
  });

  // reset raise state when a new turn starts
  createEffect(
    on(
      () => legal()?.minRaiseToCents,
      (min) => {
        if (min != null) {
          setRaiseTo(min);
          setRaising(false);
          setTyped("");
          setTyping(false);
        }
      },
    ),
  );

  const presets = createMemo(() => (ctx() ? raisePresets(ctx()!) : []));
  const stepCents = () => raiseStepCents(ctx()!) ?? t().bbCents;

  const applyPreset = (to: number) => {
    setRaising(true);
    setRaiseTo(Math.round(to));
  };

  const commitRaise = () => {
    const la = legal();
    if (!la) return;
    const to = typing() ? parseBetToCents(typed()) : raiseTo();
    if (to == null || to < la.minRaiseToCents || to > la.maxRaiseToCents) return;
    props.send({ kind: "raise", toCents: to });
    setRaising(false);
    setTyping(false);
    setTyped("");
  };

  const primary = () => {
    const la = legal();
    if (!la) return null;
    if (la.canCheck) return { label: `Check`, sub: `C`, action: { kind: "check" } as PlayerAction };
    return {
      label: `Call ${money(la.callCents)}`,
      sub: `C`,
      action: { kind: "call" } as PlayerAction,
    };
  };

  const onKey = (e: KeyboardEvent) => {
    if (!active()) return;
    // ignore when typing in the bet input (except Enter/Esc)
    const inInput = e.target instanceof HTMLInputElement;
    if (typing() && inInput && e.key !== "Enter" && e.key !== "Escape") return;
    const la = legal()!;
    switch (e.key.toLowerCase()) {
      case "f":
        if (la.canFold) {
          e.preventDefault();
          props.send({ kind: "fold" });
        }
        break;
      case "c":
        e.preventDefault();
        if (la.canCheck) props.send({ kind: "check" });
        else if (la.canCall) props.send({ kind: "call" });
        break;
      case "r":
        if (la.canRaise) {
          e.preventDefault();
          setRaising(true);
          inputEl()?.focus();
        }
        break;
      case "enter":
        e.preventDefault();
        if (raising() || typing()) commitRaise();
        else if (la.canCheck) props.send({ kind: "check" });
        else if (la.canCall) props.send({ kind: "call" });
        break;
      case "escape":
        if (raising() || typing()) {
          e.preventDefault();
          setRaising(false);
          setTyping(false);
          setTyped("");
        }
        break;
      case "arrowright":
      case "arrowup": {
        if (!la.canRaise) break;
        e.preventDefault();
        setRaising(true);
        setRaiseTo((v) =>
          Math.min(la.maxRaiseToCents, v + (e.shiftKey ? stepCents() * 2 : stepCents())),
        );
        break;
      }
      case "arrowleft":
      case "arrowdown": {
        if (!la.canRaise) break;
        e.preventDefault();
        setRaising(true);
        setRaiseTo((v) =>
          Math.max(la.minRaiseToCents, v - (e.shiftKey ? stepCents() * 2 : stepCents())),
        );
        break;
      }
    }
  };
  onMount(() => window.addEventListener("keydown", onKey));
  onCleanup(() => window.removeEventListener("keydown", onKey));

  return (
    <Show when={active()} fallback={<IdleBar table={t()} send={props.send} error={props.error} />}>
      <div class="mx-auto w-full max-w-3xl rounded-2xl border border-line bg-surface/95 p-3 shadow-2xl shadow-black/50 backdrop-blur">
        <Show when={props.error}>
          <div class="mb-2 rounded-lg bg-danger/15 px-3 py-1.5 text-xs font-medium text-danger">
            {props.error}
          </div>
        </Show>

        <div class="flex flex-col gap-3">
          {/* presets row */}
          <Show when={legal()!.canRaise}>
            <div class="flex flex-wrap items-center gap-1.5">
              <For each={presets()}>
                {(p) => (
                  <button
                    type="button"
                    class={cn(
                      "rounded-lg border px-2.5 py-1 text-xs font-semibold tabular-nums transition-colors",
                      raising() && raiseTo() === p.toCents
                        ? "border-accent bg-accent/20 text-accent"
                        : "border-line bg-surface-raised text-fg-muted hover:border-accent/40 hover:text-fg",
                    )}
                    onClick={() => applyPreset(p.toCents)}
                  >
                    {p.label}
                  </button>
                )}
              </For>
              <span class="ml-auto text-[11px] text-fg-muted">
                min {money(legal()!.minRaiseToCents)} · max {money(legal()!.maxRaiseToCents)}
              </span>
            </div>

            {/* slider + typed input — shown while raising (saves vertical space in landscape) */}
            <Show when={raising()}>
              <div class="grid gap-3 sm:grid-cols-[1fr_150px]">
                <div>
                  <Slider
                    value={[raiseTo()]}
                    onChange={(v) => {
                      // Kobalte echoes the current value on re-render; without this
                      // guard the echo clobbers preset clicks back to the old amount.
                      const nv = Math.round(v[0]);
                      if (nv !== raiseTo()) {
                        setRaising(true);
                        setRaiseTo(nv);
                      }
                    }}
                    minValue={legal()!.minRaiseToCents}
                    maxValue={legal()!.maxRaiseToCents}
                    step={t().street === "preflop" ? t().sbCents : 1}
                    aria-label="Raise amount"
                  />
                  <div class="flex justify-between text-[10px] tabular-nums text-fg-muted">
                    <span>{money(legal()!.minRaiseToCents)}</span>
                    <span>{money(legal()!.maxRaiseToCents)}</span>
                  </div>
                </div>
                <div class="relative">
                  <Input
                    ref={setInputEl}
                    name="raise-to"
                    value={typed()}
                    placeholder={`or type (${money(raiseTo())})`}
                    inputmode="decimal"
                    class="h-9 pr-16 font-mono text-sm tabular-nums"
                    onFocus={() => setTyping(true)}
                    onInput={(e) => setTyped(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRaise();
                      if (e.key === "Escape") {
                        setTyping(false);
                        setTyped("");
                        inputEl()?.blur();
                      }
                    }}
                  />
                  <span class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                    to
                  </span>
                </div>
              </div>
            </Show>
          </Show>

          {/* main buttons */}
          <div class="flex gap-2.5">
            <Button
              variant="danger"
              size="lg"
              class="flex-1 [@media(max-height:520px)]:h-9 [@media(max-height:520px)]:px-3 [@media(max-height:520px)]:text-sm"
              disabled={!legal()!.canFold}
              onClick={() => props.send({ kind: "fold" })}
            >
              Fold <kbd class="ml-1 rounded bg-black/25 px-1 text-[10px]">F</kbd>
            </Button>
            <Button
              variant="outline"
              size="lg"
              class="flex-[1.4] [@media(max-height:520px)]:h-9 [@media(max-height:520px)]:px-3 [@media(max-height:520px)]:text-sm"
              onClick={() => (primary() ? props.send(primary()!.action) : undefined)}
            >
              {primary()?.label} <kbd class="ml-1 rounded bg-black/25 px-1 text-[10px]">C</kbd>
            </Button>
            <Show when={legal()!.canRaise}>
              <Button
                size="lg"
                class="flex-[1.4] [@media(max-height:520px)]:h-9 [@media(max-height:520px)]:px-3 [@media(max-height:520px)]:text-sm"
                onClick={commitRaise}
              >
                {legal()!.maxRaiseToCents === (typing() ? parseBetToCents(typed()) : raiseTo())
                  ? "All-in"
                  : `Raise to ${money(typing() && parseBetToCents(typed()) != null ? parseBetToCents(typed())! : raiseTo())}`}
                <kbd class="ml-1 rounded bg-black/30 px-1 text-[10px]">R</kbd>
              </Button>
            </Show>
          </div>

          {/* keyboard shortcuts hint (ASPTR-193d) */}
          <div class="hidden flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-[10px] text-fg-muted [@media(max-height:520px)]:hidden sm:flex">
            <span>
              <kbd class="rounded border border-line bg-surface-raised px-1 font-sans">F</kbd> fold
            </span>
            <span>
              <kbd class="rounded border border-line bg-surface-raised px-1 font-sans">C</kbd>{" "}
              check/call
            </span>
            <Show when={legal()!.canRaise}>
              <span>
                <kbd class="rounded border border-line bg-surface-raised px-1 font-sans">R</kbd>{" "}
                raise
              </span>
            </Show>
            <span>
              <kbd class="rounded border border-line bg-surface-raised px-1 font-sans">↵</kbd>{" "}
              confirm
            </span>
            <Show when={legal()!.canRaise}>
              <span>
                <kbd class="rounded border border-line bg-surface-raised px-1 font-sans">esc</kbd>{" "}
                cancel
              </span>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}

function IdleBar(props: {
  table: TableState;
  send: (a: PlayerAction) => void;
  error: string | null;
}) {
  const t = () => props.table;
  return (
    <div class="mx-auto w-full max-w-3xl">
      <Show
        when={props.error}
        fallback={
          <Show
            when={t().postHand}
            fallback={
              <div class="rounded-2xl border border-line/60 bg-surface/50 px-4 py-2.5 text-center text-sm text-fg-muted backdrop-blur">
                {t().handNo > 0
                  ? t().street === "showdown" || t().street === "complete"
                    ? t().message
                    : "Waiting for opponents…"
                  : "Connecting…"}
              </div>
            }
          >
            {(ph) => (
              <div class="flex items-center justify-center gap-2 rounded-2xl border border-accent/40 bg-accent-tint/60 px-4 py-2.5 backdrop-blur">
                <span class="text-sm font-medium text-fg">Your decision:</span>
                <Show when={ph().bounty}>
                  <Button size="sm" onClick={() => props.send({ kind: "reveal" })}>
                    Show 7-2 (take bounty)
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => props.send({ kind: "muck" })}>
                    Muck
                  </Button>
                </Show>
                <Show when={ph().rabbit}>
                  <Button size="sm" onClick={() => props.send({ kind: "rabbit" })}>
                    Rabbit hunt
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => props.send({ kind: "muck" })}>
                    Skip
                  </Button>
                </Show>
              </div>
            )}
          </Show>
        }
      >
        <div class="rounded-2xl border border-danger/40 bg-danger/10 px-4 py-2.5 text-center text-sm font-medium text-danger">
          {props.error}
        </div>
      </Show>
    </div>
  );
}
