import type { ParentProps } from 'solid-js'
import { splitProps } from 'solid-js'
import * as SelectPrimitive from '@kobalte/core/select'
import { cn } from '../../lib/cn'

export type SelectOption = { value: string; label: string }

type SelectProps = {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  class?: string
}

/** Single-select dropdown. String values — map to typed values at call site. */
export function Select(props: SelectProps) {
  const [local, others] = splitProps(props, ['value', 'onChange', 'options', 'placeholder', 'class'])
  return (
    <SelectPrimitive.Root
      options={local.options}
      optionValue="value"
      optionTextValue="label"
      value={local.options.find((o) => o.value === local.value) ?? null}
      onChange={(o) => o != null && local.onChange(o.value)}
      placeholder={local.placeholder ?? 'Select…'}
      gutter={8}
      sameWidth
      itemComponent={(itemProps) => (
        <SelectPrimitive.Item
          item={itemProps.item}
          class="flex cursor-pointer items-center justify-between rounded-md px-2.5 py-1.5 text-sm text-fg outline-none transition-colors duration-200 data-[highlighted]:bg-surface-raised"
        >
          <SelectPrimitive.ItemLabel>{itemProps.item.rawValue.label}</SelectPrimitive.ItemLabel>
          <SelectPrimitive.ItemIndicator>
            <svg class="size-4 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </SelectPrimitive.ItemIndicator>
        </SelectPrimitive.Item>
      )}
      {...others}
    >
      <SelectPrimitive.HiddenSelect />
      <SelectPrimitive.Trigger class="flex h-9 items-center justify-between gap-2 rounded-btn border border-line bg-surface px-3 text-sm text-fg transition-colors duration-200 ease-out hover:border-black/20 data-[expanded]:border-accent/60">
        <SelectPrimitive.Value<Option> class="truncate">
          {(state) => <span class="truncate">{state.selectedOption()?.label ?? local.placeholder}</span>}
        </SelectPrimitive.Value>
        <SelectPrimitive.Icon class="flex-none text-fg-muted transition-transform duration-200 data-[expanded]:rotate-180">
          <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content class="z-50 max-h-64 overflow-y-auto rounded-card border border-line bg-surface p-1 animate-in-menu">
          <SelectPrimitive.Listbox />
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}

/** Labeled field wrapper used across forms. */
export function Field(props: ParentProps<{ label: string; hint?: string; class?: string }>) {
  return (
    <label class={cn('flex flex-col gap-1.5 text-sm', props.class)}>
      <span class="text-xs font-medium tracking-wide text-fg-muted uppercase">{props.label}</span>
      {props.children}
      {props.hint && <span class="text-xs text-fg-faint">{props.hint}</span>}
    </label>
  )
}

type Option = { value: string; label: string }
