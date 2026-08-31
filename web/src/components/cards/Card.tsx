import { Show, splitProps } from 'solid-js'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/cn'
import { SUIT_COLOR, SUIT_INK, CornerIndex, CenterMotif, BackArt } from './art'

export type Suit = 's' | 'h' | 'd' | 'c'
export type Rank =
  | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10'
  | 'J' | 'Q' | 'K' | 'A'

export const SUITS: Suit[] = ['s', 'h', 'd', 'c']
export const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']

export { SUIT_COLOR, SUIT_INK } from './art'

const cardVariants = cva('relative block select-none', {
  variants: {
    size: {
      sm: 'w-14 h-20',           // 56×80
      md: 'w-[88px] h-[124px]',  // poker-ish 1:1.4
      lg: 'w-28 h-[157px]',      // 112×157
    },
  },
  defaultVariants: { size: 'md' },
})

export type CardFaceProps = VariantProps<typeof cardVariants> & {
  rank: Rank
  suit: Suit
  fontSize?: number
  class?: string
}

/**
 * Card face: warm cream #fdf9f0, 12px radius, hairline border.
 * All art is one SVG in a 100×140 viewBox — scales crisply to any size.
 * Corner indices use SUIT_INK (suit color darkened to AA-on-cream).
 */
export function CardFace(props: CardFaceProps) {
  const [local] = splitProps(props, ['rank', 'suit', 'class'])
  const color = () => SUIT_COLOR[local.suit]
  const ink = () => SUIT_INK[local.suit]

  return (
    <div class={cn('card-face absolute inset-0 overflow-hidden rounded-[12px] bg-[#fdf9f0]', local.class)}>
      <svg class="absolute inset-0 h-full w-full" viewBox="0 0 100 140" aria-hidden="true">
        {/* corner indices: top-left + bottom-right (rotated) — inset for breathing room */}
        <g transform="translate(18 20)">
          <CornerIndex rank={local.rank} suit={local.suit} ink={ink()} />
        </g>
        <g transform="translate(82 120) rotate(180)">
          <CornerIndex rank={local.rank} suit={local.suit} ink={ink()} />
        </g>
        {/* center art: one uniform motif on every rank */}
        <CenterMotif suit={local.suit} color={color()} />
      </svg>
    </div>
  )
}

/**
 * Playing card. Renders face or lattice back; 3D flip handled by parent
 * (see CardRow) — this component is purely presentational.
 */
export type CardProps = VariantProps<typeof cardVariants> & {
  rank?: Rank
  suit?: Suit
  faceDown?: boolean
  fontSize?: number
  class?: string
}

export function Card(props: CardProps) {
  const [local, others] = splitProps(props, ['rank', 'suit', 'faceDown', 'size', 'fontSize', 'class'])
  return (
    <div
      class={cn(
        cardVariants({ size: local.size }),
        'rounded-[12px] border border-black/10 bg-[#fdf9f0] shadow-[0_1px_2px_rgba(0,0,0,0.25),0_6px_14px_-4px_rgba(0,0,0,0.4)]',
        local.class,
      )}
      role="img"
      aria-label={local.faceDown || !local.rank || !local.suit ? 'face-down card' : `${local.rank} of ${({ s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' } as const)[local.suit]}`}
      {...others}
    >
      <Show when={!local.faceDown && local.rank && local.suit} fallback={<CardBack size={local.size} />}>
        <CardFace rank={local.rank!} suit={local.suit!} size={local.size} fontSize={local.fontSize} />
      </Show>
    </div>
  )
}

/** Crimson lattice back with cream frame */
export function CardBack(props: VariantProps<typeof cardVariants> & { class?: string }) {
  const [local] = splitProps(props, ['size', 'class'])
  return (
    <div class={cn('card-back absolute inset-0 overflow-hidden rounded-[12px] bg-[#a8103f]', local.class)}>
      <BackArt />
    </div>
  )
}
