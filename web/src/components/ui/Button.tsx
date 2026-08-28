import type { JSX } from 'solid-js'
import { splitProps } from 'solid-js'
import * as ButtonPrimitive from '@kobalte/core/button'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/cn'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]',
  {
    variants: {
      variant: {
        default: 'bg-accent text-accent-fg hover:bg-accent-hover active:bg-accent shadow-sm',
        outline: 'border border-line bg-transparent text-fg hover:bg-surface-raised',
        ghost: 'bg-transparent text-fg-muted hover:bg-surface-raised hover:text-fg',
        danger: 'bg-danger text-white hover:opacity-90',
      },
      size: {
        default: 'h-9 px-4',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-11 px-6 text-base',
        icon: 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

type ButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    class?: string
    children?: JSX.Element
  }

export function Button(props: ButtonProps) {
  const [local, others] = splitProps(props, ['variant', 'size', 'class'])
  return (
    <ButtonPrimitive.Root
      class={cn(buttonVariants({ variant: local.variant, size: local.size }), local.class)}
      {...others}
    />
  )
}

export type { ButtonProps }
export { buttonVariants }
// ponytail: polymorphic `as` prop skipped — no current need; add via ButtonPrimitive.Root `as` if required.
