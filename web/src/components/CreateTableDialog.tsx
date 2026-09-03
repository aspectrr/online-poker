import { For, Show, createSignal, onMount } from "solid-js";
import { A } from "@solidjs/router";
import { Button } from "./ui/Button";
import { Dialog, DialogContent, DialogTrigger } from "./ui/Dialog";
import { Field, Select } from "./ui/Select";
import { Input } from "./ui/Input";
import { Slider } from "./ui/Slider";
import { SwitchRow } from "./ui/Switch";
import { createTable, MOCK_MODE } from "../lib/api";
import { authIdentity } from "../lib/identity";
import { money } from "../lib/money";
import {
  DEFAULT_TABLE_CONFIG,
  type BombPotMode,
  type GameType,
  type TableConfig,
  type TableSummary,
} from "../lib/types";
import { cn } from "../lib/cn";

const RANKS = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2"] as const;
const SUITS = [
  { value: "any", label: "Any suit", glyph: "♢" },
  { value: "s", label: "Spades", glyph: "♠" },
  { value: "h", label: "Hearts", glyph: "♥" },
  { value: "d", label: "Diamonds", glyph: "♦" },
  { value: "c", label: "Clubs", glyph: "♣" },
] as const;
const SUIT_COLOR: Record<string, string> = {
  s: "text-fg",
  c: "text-fg",
  h: "text-danger",
  d: "text-danger",
  any: "text-fg-muted",
};

const DEFAULT_TRIGGER = { rank: "2", suits: [] as string[] };
const SUIT_GLYPH: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };

export function CreateTableDialog(props: { onCreated: (t: TableSummary) => void }) {
  const [open, setOpen] = createSignal(false);
  const [config, setConfig] = createSignal<TableConfig>({ ...DEFAULT_TABLE_CONFIG });
  const [saving, setSaving] = createSignal(false);
  // table creation is signed-in-only (server enforces it; mirror in the UI)
  const [guest, setGuest] = createSignal(false);
  onMount(async () => {
    if (MOCK_MODE) return;
    const id = await authIdentity().catch(() => null);
    setGuest(!id || id.isGuest);
  });
  const set = (patch: Partial<TableConfig>) => setConfig((c) => ({ ...c, ...patch }));
  const [trigger, setTrigger] = createSignal({ ...DEFAULT_TRIGGER });
  // Starting stack entry unit: big blinds or dollars (server always stores bb).
  const [stackUsd, setStackUsd] = createSignal(false);
  const stackUsdValue = () =>
    +((config().startingStackBb * config().bigBlindCents) / 100).toFixed(2);
  // keep trigger mirrored into config so submit serializes it

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const created = await createTable({ ...config(), bombPotTrigger: trigger() });
      setOpen(false);
      setConfig({ ...DEFAULT_TABLE_CONFIG });
      props.onCreated(created);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open()} onOpenChange={setOpen}>
      <Show
        when={!guest()}
        fallback={
          <A href="/auth">
            <Button variant="outline" class="gap-1.5">
              Sign in to create a table
            </Button>
          </A>
        }
      >
        <DialogTrigger as={Button} class="gap-1.5">
          <svg
            aria-hidden="true"
            class="size-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          Create table
        </DialogTrigger>
      </Show>
      <DialogContent
        title="Create a table"
        description="Defaults to 0.10/0.20 NLHE, 100bb, 15s action clock."
      >
        <form id="create-table" class="flex flex-col gap-6" onSubmit={submit}>
          <Field label="Table name">
            <Input
              required
              maxlength={32}
              placeholder="e.g. Thursday Grind"
              value={config().name}
              onInput={(e) => set({ name: e.currentTarget.value })}
            />
          </Field>

          <div class="grid grid-cols-2 gap-4">
            <Field label="Game">
              <Select
                options={[
                  { value: "NLHE", label: "NLHE — Hold’em" },
                  { value: "PLO4", label: "PLO4 — Omaha" },
                ]}
                value={config().gameType}
                onChange={(v) => set({ gameType: v as GameType })}
              />
            </Field>
            <Field
              label="Starting stack"
              hint={
                stackUsd()
                  ? `= ${config().startingStackBb}bb`
                  : `= ${money(config().startingStackBb * config().bigBlindCents)}`
              }
            >
              <div class="flex gap-2">
                <Input
                  type="number"
                  min={stackUsd() ? 0.01 : 1}
                  step={stackUsd() ? 0.01 : 1}
                  required
                  class="flex-1"
                  value={stackUsd() ? stackUsdValue() : config().startingStackBb}
                  onInput={(e) => {
                    const n = Number(e.currentTarget.value);
                    if (!n) return;
                    set({
                      startingStackBb: stackUsd()
                        ? Math.max(1, Math.round((n * 100) / config().bigBlindCents))
                        : Math.max(1, Math.round(n)),
                    });
                  }}
                />
                <div
                  class="flex overflow-hidden rounded-btn border border-line"
                  role="radiogroup"
                  aria-label="Stack unit"
                >
                  <For
                    each={[
                      { u: false, label: "bb" },
                      { u: true, label: "$" },
                    ]}
                  >
                    {({ u, label }) => (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={stackUsd() === u}
                        onClick={() => setStackUsd(u)}
                        class={cn(
                          "px-3 text-sm font-semibold transition-colors",
                          stackUsd() === u
                            ? "bg-accent text-accent-fg"
                            : "bg-surface text-fg-muted hover:bg-surface-raised",
                        )}
                      >
                        {label}
                      </button>
                    )}
                  </For>
                </div>
              </div>
            </Field>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <Field label="Small blind ($)">
              <Input
                type="number"
                min={0.01}
                step={0.01}
                required
                value={config().smallBlindCents / 100}
                onInput={(e) =>
                  set({ smallBlindCents: Math.round(Number(e.currentTarget.value) * 100) || 0 })
                }
              />
            </Field>
            <Field label="Big blind ($)">
              <Input
                type="number"
                min={0.01}
                step={0.01}
                required
                value={config().bigBlindCents / 100}
                onInput={(e) =>
                  set({ bigBlindCents: Math.round(Number(e.currentTarget.value) * 100) || 0 })
                }
              />
            </Field>
          </div>
          <p class="-mt-3 text-xs text-fg-muted">
            Currently {money(config().smallBlindCents)}/{money(config().bigBlindCents)} per hand
          </p>

          <div class="grid grid-cols-2 gap-x-6 gap-y-1">
            <div>
              <div class="mb-1 flex items-baseline justify-between">
                <span class="text-xs font-medium tracking-wide text-fg-muted uppercase">
                  Action timeout
                </span>
                <span class="text-sm font-semibold tabular-nums text-accent">
                  {config().actionTimeoutSec}s
                </span>
              </div>
              <Slider
                minValue={5}
                maxValue={300}
                step={5}
                value={[config().actionTimeoutSec]}
                onChange={(v) => set({ actionTimeoutSec: v[0] })}
              />
            </div>
            <div>
              <div class="mb-1 flex items-baseline justify-between">
                <span class="text-xs font-medium tracking-wide text-fg-muted uppercase">
                  Inter-hand delay
                </span>
                <span class="text-sm font-semibold tabular-nums text-accent">
                  {config().interHandDelaySec}s
                </span>
              </div>
              <Slider
                minValue={2}
                maxValue={15}
                step={1}
                value={[config().interHandDelaySec]}
                onChange={(v) => set({ interHandDelaySec: v[0] })}
              />
            </div>
          </div>

          <div class="flex flex-col gap-4 rounded-xl border border-line bg-bg/40 p-4">
            <Field label="Run it twice" class="gap-0">
              <Select
                options={[
                  { value: "off", label: "Off" },
                  { value: "always", label: "Always" },
                  { value: "when_agreed", label: "When agreed" },
                ]}
                value={config().runItTwice}
                onChange={(v) => set({ runItTwice: v as TableConfig["runItTwice"] })}
              />
            </Field>
            <SwitchRow
              label="Rabbit hunt"
              description="Reveal remaining cards after fold-out"
              checked={config().rabbitHunt}
              onChange={(v) => set({ rabbitHunt: v })}
            />
          </div>

          <div class="flex flex-col gap-4 rounded-xl border border-line bg-bg/40 p-4">
            <Field label="Bomb pots" class="gap-0">
              <Select
                options={[
                  { value: "off", label: "Off" },
                  { value: "trigger", label: "Card trigger + manual arm" },
                  { value: "every_hand", label: "Manual only (arm in table settings)" },
                ]}
                value={config().bombPotMode}
                onChange={(v) => set({ bombPotMode: v as BombPotMode })}
              />
            </Field>
            <Show when={config().bombPotMode === "trigger"}>
              <div class="flex flex-col gap-3 rounded-lg bg-surface/60 p-3">
                <Field label="Rank" class="gap-1">
                  <div class="flex flex-wrap gap-1" role="radiogroup" aria-label="Trigger rank">
                    <For each={RANKS}>
                      {(r) => (
                        <button
                          type="button"
                          role="radio"
                          aria-checked={trigger().rank === r}
                          onClick={() => setTrigger((t) => ({ ...t, rank: r }))}
                          class={cn(
                            "h-8 min-w-8 rounded-md px-1.5 text-sm font-semibold transition-colors",
                            trigger().rank === r
                              ? "bg-accent text-accent-fg"
                              : "bg-surface-raised text-fg-muted hover:bg-line hover:text-fg",
                          )}
                        >
                          {r}
                        </button>
                      )}
                    </For>
                  </div>
                </Field>
                <Field label="Suits (multi-select)" class="gap-1">
                  <div class="flex gap-1" role="group" aria-label="Trigger suits">
                    <button
                      type="button"
                      aria-pressed={trigger().suits.length === 0}
                      onClick={() => setTrigger((t) => ({ ...t, suits: [] }))}
                      class={cn(
                        "h-8 rounded-md px-2.5 text-sm font-semibold transition-colors",
                        trigger().suits.length === 0
                          ? "bg-accent text-accent-fg"
                          : "bg-surface-raised text-fg-muted hover:bg-line hover:text-fg",
                      )}
                    >
                      Any
                    </button>
                    <For each={SUITS.filter((s) => s.value !== "any")}>
                      {(s) => (
                        <button
                          type="button"
                          aria-pressed={trigger().suits.includes(s.value)}
                          onClick={() =>
                            setTrigger((t) => ({
                              ...t,
                              suits: t.suits.includes(s.value)
                                ? t.suits.filter((x) => x !== s.value)
                                : [...t.suits, s.value],
                            }))
                          }
                          class={cn(
                            "grid h-8 w-9 place-items-center rounded-md text-base transition-colors",
                            trigger().suits.includes(s.value)
                              ? "bg-accent text-accent-fg"
                              : cn("bg-surface-raised hover:bg-line", SUIT_COLOR[s.value]),
                          )}
                          aria-label={s.label}
                        >
                          {s.glyph}
                        </button>
                      )}
                    </For>
                  </div>
                </Field>
                <p class="text-xs text-fg-muted">
                  Next hand is a bomb pot when{" "}
                  <span class="font-medium text-fg">
                    {trigger().suits.length
                      ? `a ${trigger()
                          .suits.map((s) => `${trigger().rank}${SUIT_GLYPH[s]}`)
                          .join(" or ")}`
                      : `any ${trigger().rank}`}
                  </span>{" "}
                  hits the board.
                </p>
              </div>
            </Show>
          </div>

          <div class="flex flex-col gap-4 rounded-xl border border-line bg-bg/40 p-4">
            <SwitchRow
              label="7-2 game"
              description="Bounty on every 7-2 bluff win"
              checked={config().sevenTwo}
              onChange={(v) => set({ sevenTwo: v })}
            />
            <Show when={config().sevenTwo}>
              <div class="grid grid-cols-2 items-end gap-4">
                <Field
                  label="Bounty ($)"
                  hint={`from each player — ${money(config().sevenTwoBountyCents * 9)} total at 9 seats`}
                >
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    value={config().sevenTwoBountyCents / 100}
                    onInput={(e) =>
                      set({
                        sevenTwoBountyCents: Math.round(Number(e.currentTarget.value) * 100) || 0,
                      })
                    }
                  />
                </Field>
              </div>
            </Show>
          </div>

          <div class="flex items-center justify-end gap-3 border-t border-line pt-4">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving() || !config().name.trim()}>
              {saving() ? "Creating…" : "Create table"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
