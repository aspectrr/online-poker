import { Show, splitProps } from 'solid-js'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/cn'

export type Suit = 's' | 'h' | 'd' | 'c'
export type Rank =
  | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10'
  | 'J' | 'Q' | 'K' | 'A'

export const SUITS: Suit[] = ['s', 'h', 'd', 'c']
export const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']

export const SUIT_COLOR: Record<Suit, string> = {
  s: '#1a1a1a',
  h: '#d33',
  d: '#3377dd',
  c: '#2a8a3a',
}

const SUIT_PATH: Record<Suit, string> = {
  // spade: pointed body + stem, 0..100 box
  s: 'M50 4C36 22 16 34 16 54c0 12 10 20 20 20 6 0 11-2 14-6-1 10-5 16-11 20h22c-6-4-10-10-11-20 3 4 8 6 14 6 10 0 20-8 20-20 0-20-20-32-34-50Z',
  // heart
  h: 'M50 92C28 74 10 60 10 40 10 25 21 14 34 14c8 0 13 4 16 9 3-5 8-9 16-9 13 0 24 11 24 26 0 20-18 34-40 52Z',
  // diamond
  d: 'M50 4 88 50 50 96 12 50Z',
  // club: three circles + stem, approximated with path arcs
  c: 'M50 6a16 16 0 0 1 15.6 19.7A16 16 0 1 1 57.5 52c3 12 7 20 13 24H29.5c6-4 10-12 13-24a16 16 0 1 1-8.1-26.3A16 16 0 0 1 50 6Z',
}

const cardVariants = cva('relative block select-none', {
  variants: {
    size: {
      sm: 'w-14 h-20',   // 56×80
      md: 'w-[88px] h-[124px]', // poker-ish 1:1.4
      lg: 'w-28 h-[157px]', // 112×157
    },
  },
  defaultVariants: { size: 'md' },
})

export type CardFaceProps = VariantProps<typeof cardVariants> & {
  rank: Rank
  suit: Suit
  /** px font-size for corner rank — drives pip/court geometry via em units */
  fontSize?: number
  class?: string
}

// Pip layouts for 2–10: col = side-column x fraction (0.5 = single center column),
// rows = y fractions per column.
type PipSpec = { col: number; rows: number[] }
const PIPS: Record<Exclude<Rank, 'J' | 'Q' | 'K' | 'A'>, PipSpec> = {
  '2':  { col: 0.5, rows: [0.2, 0.8] },
  '3':  { col: 0.5, rows: [0.2, 0.5, 0.8] },
  '4':  { col: 0.32, rows: [0.2, 0.8] },
  '5':  { col: 0.32, rows: [0.2, 0.8] },
  '6':  { col: 0.32, rows: [0.2, 0.5, 0.8] },
  '7':  { col: 0.32, rows: [0.2, 0.5, 0.8] },
  '8':  { col: 0.32, rows: [0.2, 0.5, 0.8] },
  '9':  { col: 0.32, rows: [0.2, 0.395, 0.605, 0.8] },
  '10': { col: 0.32, rows: [0.2, 0.395, 0.605, 0.8] },
}
// center-column pips per rank (5: center; 7: upper-middle; 8: two; 9: center; 10: two)
const CENTER_PIPS: Partial<Record<Rank, number[]>> = {
  '5': [0.5], '7': [0.35], '8': [0.35, 0.65], '9': [0.5], '10': [0.3, 0.7],
}
// rows rendered rotated 180° (lower half of card), per rank
const FLIP_ROWS: Partial<Record<Rank, number[]>> = {
  '2': [0.8], '3': [0.8], '5': [0.8], '6': [0.8], '7': [0.8],
  '8': [0.65, 0.8], '9': [0.605, 0.8], '10': [0.605, 0.8],
}

const CORNER_FRACTION = 0.26 // corner block width fraction

export function CardFace(props: CardFaceProps) {
  const [local, others] = splitProps(props, ['rank', 'suit', 'size', 'fontSize', 'class'])
  const color = () => SUIT_COLOR[local.suit]
  const isCourt = () => 'JQKA'.includes(local.rank)

  const corner = (corner: 'tl' | 'br') => (
    <div
      class="absolute flex flex-col items-center"
      style={{
        left: corner === 'tl' ? '5.5%' : 'auto',
        right: corner === 'br' ? '5.5%' : 'auto',
        top: corner === 'tl' ? '4.5%' : 'auto',
        bottom: corner === 'br' ? '4.5%' : 'auto',
        transform: corner === 'br' ? 'rotate(180deg)' : undefined,
        width: `${CORNER_FRACTION * 100}%`,
      }}
    >
      <div style={{ 'font-size': `${local.fontSize ?? 30}px`, 'line-height': 1, 'font-family': 'var(--font-display)' }} class="font-bold">{local.rank}</div>
      <SuitGlyph suit={local.suit} size={(local.fontSize ?? 30) * 0.62} />
    </div>
  )

  return (
    <div class={cn('card-face absolute inset-0', local.class)} {...others}>
      {/* corner indices */}
      {corner('tl')}
      {corner('br')}
      <Show when={isCourt()} fallback={<Pips rank={local.rank} suit={local.suit} fontSize={local.fontSize ?? 30} />}>
        {/* court / ace: letter above big suit, both centered */}
        <div class="absolute inset-0 flex flex-col items-center justify-center" style={{ 'font-size': `${local.fontSize ?? 30}px` }}>
          <span class="font-display font-bold leading-none tracking-tight" style={{ 'font-size': '2.5em', color: color() }}>
            {local.rank}
          </span>
          <SuitGlyph suit={local.suit} size={(local.fontSize ?? 30) * 2.1} />
        </div>
      </Show>
    </div>
  )
}

function SuitGlyph(props: { suit: Suit; size: number }) {
  return (
    <svg width={props.size} height={props.size} viewBox="0 0 100 100" aria-hidden="true"
      style={{ 'margin-left': 'auto', 'margin-right': 'auto', display: 'block' }}>
      <path d={SUIT_PATH[props.suit]} fill={SUIT_COLOR[props.suit]} />
    </svg>
  )
}

function Pips(props: { rank: Rank; suit: Suit; fontSize: number }) {
  const spec = () => PIPS[props.rank as Exclude<Rank, 'J' | 'Q' | 'K' | 'A'>]
  const pipSize = () => props.fontSize * 0.85
  const cols = () => (spec().col >= 0.5 ? [spec().col] : [spec().col, 1 - spec().col])
  const flipped = (row: number) => (FLIP_ROWS[props.rank] ?? []).includes(row)

  const pip = (x: number, y: number, flip: boolean) => (
    <div class="absolute" style={{
      left: `${x * 100}%`, top: `${y * 100}%`,
      transform: `translate(-50%, -50%) ${flip ? 'rotate(180deg)' : ''}`,
    }}>
      <SuitGlyph suit={props.suit} size={pipSize()} />
    </div>
  )

  return (
    <>
      {/* side columns */}
      {cols().map((x) => spec().rows.map((y) => pip(x, y, flipped(y))) )}
      {/* center column pips */}
      {(CENTER_PIPS[props.rank] ?? []).map((y) => pip(0.5, y, false))}
    </>
  )
}

/** Felt-themed lattice back */
export function CardBack(props: VariantProps<typeof cardVariants> & { class?: string }) {
  const [local, others] = splitProps(props, ['size', 'class'])
  return (
    <div class={cn('card-back absolute inset-0 overflow-hidden', local.class)} {...others}>
      <svg class="absolute inset-0 h-full w-full" viewBox="0 0 112 157" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <pattern id="felt-lattice" width="16" height="16" patternUnits="userSpaceOnUse">
            <rect width="16" height="16" fill="#123128" />
            <path d="M0 8h16M8 0v16" stroke="#1d5c40" stroke-width="1.2" />
            <circle cx="8" cy="8" r="2.2" fill="#d4af37" opacity="0.5" />
            <circle cx="0" cy="0" r="1.1" fill="#d4af37" opacity="0.35" />
            <circle cx="16" cy="0" r="1.1" fill="#d4af37" opacity="0.35" />
            <circle cx="0" cy="16" r="1.1" fill="#d4af37" opacity="0.35" />
            <circle cx="16" cy="16" r="1.1" fill="#d4af37" opacity="0.35" />
          </pattern>
        </defs>
        <rect x="6" y="6" width="100" height="145" rx="4" fill="url(#felt-lattice)" stroke="#d4af37" stroke-opacity="0.45" stroke-width="1" />
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
  const sizePx = () => ({ sm: 22, md: 30, lg: 38 })[local.size ?? 'md']
  return (
    <div
      class={cn(
        cardVariants({ size: local.size }),
        'rounded-lg border border-black/15 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.35),0_4px_10px_-2px_rgba(0,0,0,0.4)]',
        local.class,
      )}
      role="img"
      aria-label={local.faceDown || !local.rank || !local.suit ? 'face-down card' : `${local.rank} of ${({ s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' } as const)[local.suit]}`}
      {...others}
    >
      <Show when={!local.faceDown && local.rank && local.suit} fallback={<CardBack size={local.size} />}>
        <CardFace rank={local.rank!} suit={local.suit!} size={local.size} fontSize={local.fontSize ?? sizePx()} />
      </Show>
    </div>
  )
}
