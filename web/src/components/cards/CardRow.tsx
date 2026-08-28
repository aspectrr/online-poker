import { For, splitProps } from 'solid-js'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/cn'
import { Card, type Rank, type Suit } from './Card'

export type CardSpec = { rank: Rank; suit: Suit; win?: boolean }

const rowVariants = cva('flex items-center', {
  variants: {
    gap: {
      tight: 'gap-1.5',
      default: 'gap-2.5',
      loose: 'gap-5',
    },
  },
  defaultVariants: { gap: 'default' },
})

export type CardRowProps = VariantProps<typeof rowVariants> & {
  cards: CardSpec[]
  /** number of cards rendered face-down (from the left) until flip */
  faceDownCount?: number
  /** flips the whole row face-down when false */
  revealed?: boolean
  size?: 'sm' | 'md' | 'lg'
  class?: string
}

/**
 * Board/hole card row with 3D flip. Each card is a rotateY flipper:
 * face and back live back-to-back inside a preserve-3d wrapper, so the
 * flip is pure CSS on the wrapper (no JS measurement).
 * Add `animate-deal` + `dealDelay(i)` style on the row for deal-in stagger.
 */
export function CardRow(props: CardRowProps) {
  const [local, others] = splitProps(props, ['cards', 'faceDownCount', 'revealed', 'size', 'gap', 'class'])
  const downCount = () => Math.min(local.faceDownCount ?? 0, local.cards.length)
  return (
    <div class={cn(rowVariants({ gap: local.gap }), local.class)} {...others}>
      <For each={local.cards}>
        {(card, i) => (
          <div class="card-3d [perspective:900px]" classList={{ 'card-win': !!card.win }}>
            <div
              class="relative transition-transform duration-500 [transform-style:preserve-3d]"
              classList={{ '[transform:rotateY(180deg)]': local.revealed === false || i() < downCount() }}
            >
              <div class="[backface-visibility:hidden]">
                <Card rank={card.rank} suit={card.suit} size={local.size} />
              </div>
              <div class="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)]">
                <Card faceDown size={local.size} />
              </div>
            </div>
          </div>
        )}
      </For>
    </div>
  )
}

/** per-card deal stagger: spread onto a card wrapper's style */
export function dealDelay(index: number, perCardMs = 90) {
  return { 'animation-delay': `${index * perCardMs}ms` }
}
