import { splitProps } from 'solid-js'
import * as SwitchPrimitive from '@kobalte/core/switch'
import { cn } from '../../lib/cn'

type SwitchProps = Omit<SwitchPrimitive.SwitchRootProps, 'onChange'> & {
  class?: string
  onChange?: (checked: boolean) => void
}

export function Switch(props: SwitchProps) {
  const [local, others] = splitProps(props, ['class', 'onChange'])
  return (
    <SwitchPrimitive.Root
      class={cn('flex shrink-0', local.class)}
      onChange={local.onChange}
      validationState={undefined}
      {...others}
    >
      <SwitchPrimitive.Input class="sr-only" />
      <SwitchPrimitive.Control
        class={cn(
          'relative inline-flex h-5 w-9 cursor-pointer items-center rounded-full border border-line transition-colors duration-200',
          'data-[checked]:border-accent/60 data-[checked]:bg-accent/80 data-[unchecked]:bg-surface-raised',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]',
        )}
      >
        <SwitchPrimitive.Thumb class="pointer-events-none block size-3.5 translate-x-[3px] rounded-full bg-fg-muted shadow transition-transform duration-200 data-[checked]:translate-x-[19px] data-[checked]:bg-accent-fg" />
      </SwitchPrimitive.Control>
    </SwitchPrimitive.Root>
  )
}

/** Row with label + switch, used in settings sections. */
export function SwitchRow(props: { label: string; description?: string; class?: string } & SwitchProps) {
  const [local, others] = splitProps(props, ['label', 'description', 'class'])
  return (
    <label class={cn('flex items-center justify-between gap-4', local.class)}>
      <span class="flex flex-col">
        <span class="text-sm font-medium text-fg">{local.label}</span>
        {local.description && <span class="text-xs text-fg-muted">{local.description}</span>}
      </span>
      <Switch {...others} />
    </label>
  )
}
