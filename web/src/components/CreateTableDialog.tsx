import { For, Show, createSignal } from 'solid-js'
import { Button } from './ui/Button'
import { Dialog, DialogContent, DialogTrigger } from './ui/Dialog'
import { Field, Select } from './ui/Select'
import { Input } from './ui/Input'
import { Slider } from './ui/Slider'
import { SwitchRow } from './ui/Switch'
import { createTable } from '../lib/api'
import { money } from '../lib/money'
import { DEFAULT_TABLE_CONFIG, type BombPotMode, type GameType, type TableConfig } from '../lib/types'
import { cn } from '../lib/cn'

const RANKS = ['any', 'A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'] as const
const SUITS = [
  { value: 'any', label: 'Any suit', glyph: '♢' },
  { value: 's', label: 'Spades', glyph: '♠' },
  { value: 'h', label: 'Hearts', glyph: '♥' },
  { value: 'd', label: 'Diamonds', glyph: '♦' },
  { value: 'c', label: 'Clubs', glyph: '♣' },
] as const
const SUIT_COLOR: Record<string, string> = { s: 'text-fg', c: 'text-fg', h: 'text-danger', d: 'text-danger', any: 'text-fg-muted' }

const DEFAULT_TRIGGER = { rank: 'any', suit: 'any' }
function suitName(suit: string): string {
  return SUITS.find((s) => s.value === suit)?.label.replace(' suit', '') ?? 'any suit'
}

export function CreateTableDialog(props: { onCreated: () => void }) {
  const [open, setOpen] = createSignal(false)
  const [config, setConfig] = createSignal<TableConfig>({ ...DEFAULT_TABLE_CONFIG })
  const [saving, setSaving] = createSignal(false)
  const set = (patch: Partial<TableConfig>) => setConfig((c) => ({ ...c, ...patch }))
  const [trigger, setTrigger] = createSignal({ ...DEFAULT_TRIGGER })
  // keep trigger mirrored into config so submit serializes it

  const submit = async (e: SubmitEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await createTable({ ...config(), bombPotTrigger: trigger() })
      setOpen(false)
      setConfig({ ...DEFAULT_TABLE_CONFIG })
      props.onCreated()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open()} onOpenChange={setOpen}>
      <DialogTrigger
        as={Button}
        class="gap-1.5"
      >
        <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Create table
      </DialogTrigger>
      <DialogContent title="Create a table" description="Defaults to 0.10/0.20 NLHE, 100bb, 15s action clock.">
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
                  { value: 'NLHE', label: 'NLHE — Hold’em' },
                  { value: 'PLO4', label: 'PLO4 — Omaha' },
                ]}
                value={config().gameType}
                onChange={(v) => set({ gameType: v as GameType })}
              />
            </Field>
            <Field label="Starting stack" hint={`${config().startingStackBb}bb = ${money(config().startingStackBb * config().bigBlindCents)}`}>
              <Select
                options={[50, 100, 200].map((bb) => ({ value: String(bb), label: `${bb} bb` }))}
                value={String(config().startingStackBb)}
                onChange={(v) => set({ startingStackBb: Number(v) })}
              />
            </Field>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <Field label="Small blind">
              <Input
                type="number" min={1} step={1} required
                value={config().smallBlindCents}
                onInput={(e) => set({ smallBlindCents: Number(e.currentTarget.value) || 0 })}
              />
            </Field>
            <Field label="Big blind">
              <Input
                type="number" min={2} step={1} required
                value={config().bigBlindCents}
                onInput={(e) => set({ bigBlindCents: Number(e.currentTarget.value) || 0 })}
              />
            </Field>
          </div>
          <p class="-mt-3 text-xs text-fg-muted">
            Blinds in cents — currently {money(config().smallBlindCents)}/{money(config().bigBlindCents)}
          </p>

          <div class="grid grid-cols-2 gap-x-6 gap-y-1">
            <div>
              <div class="mb-1 flex items-baseline justify-between">
                <span class="text-xs font-medium tracking-wide text-fg-muted uppercase">Action timeout</span>
                <span class="text-sm font-semibold tabular-nums text-accent">{config().actionTimeoutSec}s</span>
              </div>
              <Slider
                minValue={5} maxValue={300} step={5}
                value={[config().actionTimeoutSec]}
                onChange={(v) => set({ actionTimeoutSec: v[0] })}
              />
            </div>
            <div>
              <div class="mb-1 flex items-baseline justify-between">
                <span class="text-xs font-medium tracking-wide text-fg-muted uppercase">Inter-hand delay</span>
                <span class="text-sm font-semibold tabular-nums text-accent">{config().interHandDelaySec}s</span>
              </div>
              <Slider
                minValue={2} maxValue={15} step={1}
                value={[config().interHandDelaySec]}
                onChange={(v) => set({ interHandDelaySec: v[0] })}
              />
            </div>
          </div>

          <div class="flex flex-col gap-4 rounded-xl border border-line bg-bg/40 p-4">
            <Field label="Run it twice" class="gap-0">
              <Select
                options={[
                  { value: 'off', label: 'Off' },
                  { value: 'always', label: 'Always' },
                  { value: 'when_agreed', label: 'When agreed' },
                ]}
                value={config().runItTwice}
                onChange={(v) => set({ runItTwice: v as TableConfig['runItTwice'] })}
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
                  { value: 'off', label: 'Off' },
                  { value: 'every_hand', label: 'Manual (arm in table settings)' },
                  { value: 'trigger', label: 'Card trigger' },
                ]}
                value={config().bombPotMode}
                onChange={(v) => set({ bombPotMode: v as BombPotMode })}
              />
            </Field>
            <Show when={config().bombPotMode === 'trigger'}>
              <div class="grid grid-cols-2 gap-4 rounded-lg bg-surface/60 p-3">
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
                            'h-8 min-w-8 rounded-md px-1.5 text-sm font-semibold transition-colors',
                            trigger().rank === r
                              ? 'bg-accent text-accent-fg'
                              : 'bg-surface-raised text-fg-muted hover:bg-line hover:text-fg',
                          )}
                        >
                          {r === 'any' ? 'Any' : r}
                        </button>
                      )}
                    </For>
                  </div>
                </Field>
                <Field label="Suit" class="gap-1">
                  <div class="flex gap-1" role="radiogroup" aria-label="Trigger suit">
                    <For each={SUITS}>
                      {(s) => (
                        <button
                          type="button"
                          role="radio"
                          aria-checked={trigger().suit === s.value}
                          onClick={() => setTrigger((t) => ({ ...t, suit: s.value }))}
                          class={cn(
                            'grid h-8 w-9 place-items-center rounded-md text-base transition-colors',
                            trigger().suit === s.value
                              ? 'bg-accent text-accent-fg'
                              : cn('bg-surface-raised hover:bg-line', SUIT_COLOR[s.value]),
                          )}
                          aria-label={s.label}
                        >
                          {s.glyph}
                        </button>
                      )}
                    </For>
                  </div>
                </Field>
                <p class="col-span-2 text-xs text-fg-muted">
                  Next hand is a bomb pot when a{' '}
                  <span class="font-medium text-fg">
                    {trigger().rank === 'any' ? 'any card' : `a ${trigger().rank}`}
                  </span>{' '}
                  of{' '}
                  <span class="font-medium text-fg">{suitName(trigger().suit)}</span>{' '}
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
                <Field label="Bounty" hint={`from each player — ${money(config().sevenTwoBountyCents * 9)} total at 9 seats`}>
                  <Input
                    type="number" min={0} step={1}
                    value={config().sevenTwoBountyCents}
                    onInput={(e) => set({ sevenTwoBountyCents: Number(e.currentTarget.value) || 0 })}
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
              {saving() ? 'Creating…' : 'Create table'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
