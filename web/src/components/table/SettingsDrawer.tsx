import { For, Show } from 'solid-js'
import type { TableConfigView } from '../../lib/protocol'
import { money } from '../../lib/money'
import { Button } from '../ui/Button'
import { cn } from '../../lib/cn'

/**
 * Read-only table settings slide-over: the active config (RIT, 7-2, bomb
 * pot, timeouts). In manual bomb-pot mode it also exposes the arm button.
 */
export function SettingsDrawer(props: {
  open: boolean
  cfg: TableConfigView
  gameType: string
  blinds: string
  bombPotLive: boolean
  onArmBombPot: () => void
  onClose: () => void
}) {
  const rows = () => {
    const c = props.cfg
    return [
      { label: 'Game', value: props.gameType },
      { label: 'Blinds', value: props.blinds },
      { label: 'Action timeout', value: c.actionTimeoutS > 0 ? `${c.actionTimeoutS}s` : 'none' },
      { label: 'Inter-hand delay', value: `${c.interHandDelayS}s` },
      { label: 'Run it twice', value: c.rit === 'always' ? 'always' : 'never' },
      { label: 'Rabbit hunt', value: c.rabbitHunt ? 'on' : 'off' },
      {
        label: '7-2 bounty',
        value: c.sevenDeuce ? `on — ${money(c.sevenDeuceBounty)} per player` : 'off',
      },
      { label: 'Bomb pot', value: bombPotValue(c) },
    ]
  }

  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Table settings">
        {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer shortcut only; close button and Escape path live in the drawer */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: see above */}
        <div class="absolute inset-0 bg-black/40" onClick={props.onClose} />
        <div class="absolute inset-y-0 right-0 flex w-80 max-w-[85vw] flex-col border-l border-line bg-surface shadow-2xl animate-in-left">
          <div class="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 class="font-display text-sm font-bold">Table settings</h2>
            <button
              type="button"
              class="rounded-lg px-2 py-1 text-sm text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg"
              onClick={props.onClose}
            >
              close
            </button>
          </div>

          <div class="flex-1 overflow-y-auto px-4 py-3">
            <dl class="flex flex-col gap-0.5">
              <For each={rows()}>
                {(row) => (
                  <div class="flex items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 odd:bg-surface-raised/60">
                    <dt class="text-[13px] text-fg-muted">{row.label}</dt>
                    <dd class="text-right text-[13px] font-semibold text-fg">{row.value}</dd>
                  </div>
                )}
              </For>
            </dl>

            <Show when={props.cfg.bombPotTriggers.length > 0}>
              <h3 class="mb-1.5 mt-4 text-[11px] font-bold uppercase tracking-wider text-fg-muted">
                Bomb pot triggers
              </h3>
              <div class="flex flex-wrap gap-1.5">
                <For each={props.cfg.bombPotTriggers}>
                  {(tr) => <span class={cn('rounded-md border border-line px-2 py-0.5 text-xs font-semibold', triggerColor(tr))}>{triggerText(tr)}</span>}
                </For>
              </div>
            </Show>
          </div>

          <Show when={props.cfg.bombPotMode === 'manual' && !props.bombPotLive}>
            <div class="border-t border-line px-4 py-3">
              <Button class="w-full" onClick={() => { props.onArmBombPot(); props.onClose() }}>
                Arm bomb pot next hand
              </Button>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  )
}

function bombPotValue(c: TableConfigView): string {
  switch (c.bombPotMode) {
    case 'manual': return 'manual'
    case 'trigger': return 'card trigger'
    default: return 'off'
  }
}

function triggerText(tr: { rank?: number; suit?: number; color?: string }): string {
  const rank = tr.rank != null ? '23456789TJQKA'[tr.rank - 2] : '?'
  if (tr.suit != null) return rank + { 0: '♠', 1: '♥', 2: '♦', 3: '♣' }[tr.suit]
  if (tr.color === 'red' || tr.color === 'black') return `${tr.color} ${rank}`
  return `any ${rank}`
}

function triggerColor(tr: { color?: string; suit?: number }): string {
  const red = tr.color === 'red' || tr.suit === 1 || tr.suit === 2
  return red ? 'text-danger' : 'text-fg'
}
