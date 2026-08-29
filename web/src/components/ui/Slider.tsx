import { splitProps } from 'solid-js'
import * as SliderPrimitive from '@kobalte/core/slider'
import { cn } from '../../lib/cn'

type SliderProps = Omit<SliderPrimitive.SliderRootProps, 'value'> & {
  class?: string
  value?: number[]
  onChange?: (value: number[]) => void
}

/** Single-thumb slider with visible value bubble supplied by call site. */
export function Slider(props: SliderProps) {
  const [local, others] = splitProps(props, ['class', 'value', 'onChange'])
  return (
    <SliderPrimitive.Root
      class={cn('relative flex w-full touch-none select-none items-center py-2', local.class)}
      value={local.value}
      onChange={local.onChange}
      {...others}
    >
      <SliderPrimitive.Track class="relative h-1.5 w-full grow overflow-hidden rounded-full bg-surface-raised">
        <SliderPrimitive.Fill class="absolute h-full rounded-full bg-accent" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb class="block size-4 rounded-full border-2 border-accent bg-surface transition-transform duration-200 ease-out hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] active:scale-95">
        <SliderPrimitive.Input />
      </SliderPrimitive.Thumb>
    </SliderPrimitive.Root>
  )
}
