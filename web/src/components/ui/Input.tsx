import type { JSX } from 'solid-js'
import { splitProps } from 'solid-js'
import { cn } from '../../lib/cn'

/** Styled input — label/hint handled by <Field>. */
export function Input(props: JSX.InputHTMLAttributes<HTMLInputElement> & { class?: string }) {
  const [local, others] = splitProps(props, ['class'])
  return (
    <input
      class={cn(
        'flex h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm text-fg transition-colors placeholder:text-fg-muted/60',
        'focus:border-accent/60 focus:ring-2 focus:ring-[var(--focus-ring)] focus:outline-none',
        local.class,
      )}
      {...others}
    />
  )
}
