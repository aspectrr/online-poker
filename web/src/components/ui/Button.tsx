import type { JSX } from 'solid-js'
import { splitProps } from 'solid-js'
import * as ButtonPrimitive from '@kobalte/core/button'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/cn'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-btn text-sm font-medium whitespace-nowrap transition-colors duration-200 ease-out disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]',
  {
    variants: {
      variant: {
        // Primary CTA — filled notion blue, the only chromatic fill (DESIGN.md)
        default: 'bg-accent text-accent-fg hover:bg-accent-hover active:bg-accent-hover',
        // Ghost CTA — sky tint bg, blue text (DESIGN.md)
        ghost: 'bg-accent-tint text-accent hover:bg-[#d6ecfc] active:bg-[#d6ecfc]',
        // Ghost text — transparent, ink 95% (DESIGN.md)
        text: 'bg-transparent text-fg hover:bg-surface-raised',
        // Outlined text — 1px ink-90 border, radius 4 (DESIGN.md)
        outline: 'border border-black/90 bg-transparent text-fg/90 hover:bg-surface-raised rounded-small',
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
