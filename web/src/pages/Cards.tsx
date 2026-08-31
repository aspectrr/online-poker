import { For, Show, createSignal } from "solid-js";
import { A } from "@solidjs/router";
import { Button } from "../components/ui/Button";
import { Card, RANKS, SUITS, type Rank } from "../components/cards/Card";
import { CardRow, dealDelay, type CardSpec } from "../components/cards/CardRow";
import { RabbitMark } from "../components/cards/RabbitMark";
import { Logo } from "../components/Logo";

const PIP_RANKS: Rank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "10"];
/** deterministic-ish demo hands */
const HERO_HOLE: CardSpec[] = [
  { rank: "A", suit: "s" },
  { rank: "K", suit: "s" },
];
const FULL_BOARD: CardSpec[] = [
  { rank: "Q", suit: "s" },
  { rank: "J", suit: "s" },
  { rank: "10", suit: "s" },
  { rank: "7", suit: "h" },
  { rank: "2", suit: "d" },
];

export function CardsPage() {
  // playground state
  const [boardCount, setBoardCount] = createSignal(0);
  const [revealed, setRevealed] = createSignal(false);
  const [winners, setWinners] = createSignal(false);
  const [chips, setChips] = createSignal<number[]>([]);
  const [flying, setFlying] = createSignal(false);

  const board = () => FULL_BOARD.slice(0, boardCount()).map((c) => ({ ...c, win: winners() }));

  const dealBoard = () => {
    setWinners(false);
    setBoardCount(0);
    requestAnimationFrame(() => setBoardCount(5));
  };

  const flipHole = () => setRevealed((v) => !v);
  const pulseWin = () => setWinners((v) => !v);

  const flyChips = () => {
    if (flying()) return;
    setFlying(true);
    setChips([0, 1, 2, 3, 4, 5]);
    setTimeout(() => {
      setChips([]);
      setFlying(false);
    }, 1000);
  };

  return (
    <div class="min-h-dvh bg-bg">
      <header class="sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur-md shadow-[0px_0.7px_1.462px_0px_rgb(0_0_0/0.015),0px_3px_9px_0px_rgb(0_0_0/0.03)]">
        <div class="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <A href="/" class="flex items-center gap-2.5">
            <span class="grid size-8 place-items-center rounded-btn bg-accent-tint text-accent">
              <Logo class="size-5" />
            </span>
            <span class="font-display text-base font-bold tracking-tight text-fg">riverrats</span>
          </A>
          <span class="rounded-pill border border-line bg-surface px-2.5 py-0.5 text-xs font-medium text-fg-muted">
            /cards · ASPTR-195
          </span>
        </div>
      </header>

      <main class="mx-auto max-w-6xl space-y-14 px-4 pt-8 pb-16 sm:px-6">
        {/* ---- Animation playground ---- */}
        <section>
          <h2 class="font-display text-xl font-bold tracking-tight text-fg">Playground</h2>
          <p class="mt-1 text-sm text-fg-muted">
            Deal, flip, win pulse, chip fly — the pieces the table view will compose.
          </p>

          <div class="relative mt-6 overflow-hidden rounded-card border border-line bg-accent-tint p-8 sm:p-12">
            {/* rail ellipse hint */}
            <div class="pointer-events-none absolute inset-x-10 top-1/2 h-40 -translate-y-1/2 rounded-[50%] border border-black/5" />

            <div class="flex flex-col items-center gap-8">
              {/* hero hole cards */}
              <div class="flex flex-col items-center gap-2">
                <span class="text-xs font-semibold uppercase tracking-widest text-fg-muted">
                  Hero
                </span>
                <CardRow cards={HERO_HOLE} revealed={revealed()} size="md" />
              </div>

              {/* board */}
              <div class="relative flex min-h-[124px] flex-col items-center gap-2">
                <span class="text-xs font-semibold uppercase tracking-widest text-fg-muted">
                  Board
                </span>
                <div class="flex items-center gap-2.5">
                  <For each={board()}>
                    {(card, i) => (
                      <div class="animate-deal" style={dealDelay(i(), 110)}>
                        <CardRow cards={[card]} />
                      </div>
                    )}
                  </For>
                  {/* empty board slots */}
                  <For each={Array.from({ length: 5 - board().length })}>
                    {() => (
                      <div class="h-[124px] w-[88px] rounded-lg border border-dashed border-black/15" />
                    )}
                  </For>
                </div>
                {/* pot + chip fly origin */}
                <div class="relative mt-3 flex h-12 items-center gap-3">
                  <Show when={boardCount() > 0}>
                    <span class="text-sm font-semibold text-accent">Pot $240</span>
                  </Show>
                  {/* flying chips spawn here */}
                  <For each={chips()}>
                    {(_, i) => (
                      <div
                        class="chip chip-fly absolute left-1/2 top-0"
                        style={{
                          "--chip-x": `${(i() % 3) * 30 - 20}px`,
                          "--chip-y": "-110px",
                          "animation-delay": `${i() * 70}ms`,
                        }}
                      />
                    )}
                  </For>
                </div>
              </div>
            </div>
          </div>

          <div class="mt-5 flex flex-wrap gap-3">
            <Button onClick={dealBoard}>Deal board</Button>
            <Button variant="outline" onClick={flipHole}>
              {revealed() ? "Muck hole cards" : "Flip hole cards"}
            </Button>
            <Button variant="outline" onClick={pulseWin}>
              {winners() ? "Clear win pulse" : "Win pulse"}
            </Button>
            <Button variant="outline" onClick={flyChips}>
              Ship pot
            </Button>
          </div>
        </section>

        {/* ---- corner legibility at sm (the acceptance bar) ---- */}
        <section>
          <h2 class="font-display text-xl font-bold tracking-tight text-fg">
            Corner legibility · sm &amp; 40px
          </h2>
          <p class="mt-1 text-sm text-fg-muted">
            Rank readable at a glance — sm (56×80) and a 40px-height card. If the corner fails here,
            it fails.
          </p>
          <div class="mt-5 space-y-5 rounded-2xl border border-line bg-surface p-6">
            <div class="flex flex-wrap items-end gap-1.5">
              <For each={RANKS}>{(rank) => <Card rank={rank} suit="s" size="sm" />}</For>
            </div>
            <div class="flex flex-wrap items-end gap-1">
              <For each={RANKS}>
                {(rank) => (
                  <div class="h-10 w-[28.6px] [&>div]:!h-10 [&>div]:!w-[28.6px]">
                    <Card rank={rank} suit="h" />
                  </div>
                )}
              </For>
            </div>
          </div>
        </section>

        {/* ---- pip layout showcase ---- */}
        <section>
          <h2 class="font-display text-xl font-bold tracking-tight text-fg">Pip layouts</h2>
          <p class="mt-1 text-sm text-fg-muted">
            Every rank shares one center motif — diagonal rule + suit glyph.
          </p>
          <div class="mt-5 grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-3">
            <For each={PIP_RANKS}>
              {(rank, i) => (
                <div class="animate-deal" style={dealDelay(i(), 50)}>
                  <Card rank={rank} suit={SUITS[i() % 4]} />
                </div>
              )}
            </For>
          </div>
        </section>

        {/* ---- courts + aces showcase ---- */}
        <section>
          <h2 class="font-display text-xl font-bold tracking-tight text-fg">Courts &amp; aces</h2>
          <p class="mt-1 text-sm text-fg-muted">
            Giant corner ranks; one uniform center motif (rule + suit glyph) on every rank.
          </p>
          <div class="mt-5 flex flex-wrap gap-3">
            <For each={SUITS}>
              {(suit) => (
                <For each={["K", "Q", "J", "A"] as Rank[]}>
                  {(rank) => <Card rank={rank} suit={suit} />}
                </For>
              )}
            </For>
          </div>
        </section>

        {/* ---- 52-card deck grid ---- */}
        <section>
          <div class="flex items-end justify-between gap-4">
            <div>
              <h2 class="font-display text-xl font-bold tracking-tight text-fg">Full deck</h2>
              <p class="mt-1 text-sm text-fg-muted">
                All 52 — cream faces, pastel suits, crimson lattice backs.
              </p>
            </div>
            <span class="text-xs text-fg-muted">52 cards, 4 suits × 13 ranks</span>
          </div>
          <div class="mt-5 grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-3">
            <For each={RANKS}>
              {(rank) => <For each={SUITS}>{(suit) => <Card rank={rank} suit={suit} />}</For>}
            </For>
          </div>
        </section>

        {/* ---- sizes, back, rabbit ---- */}
        <section>
          <h2 class="font-display text-xl font-bold tracking-tight text-fg">
            Sizes, back &amp; rabbit
          </h2>
          <p class="mt-1 text-sm text-fg-muted">
            sm / md / lg, crimson lattice back, and the RabbitMark mascot (rabbit-hunt toasts).
          </p>
          <div class="mt-5 flex flex-wrap items-end gap-8 rounded-card border border-line bg-surface p-8">
            <Card rank="A" suit="s" size="sm" />
            <Card rank="K" suit="h" size="md" />
            <Card rank="Q" suit="d" size="lg" />
            <Card faceDown size="sm" />
            <Card faceDown size="md" />
            <Card faceDown size="lg" />
            <div class="flex items-center gap-3 pb-2">
              <RabbitMark size={24} />
              <RabbitMark size={32} />
              <RabbitMark size={48} />
              <span class="text-xs text-fg-muted">RabbitMark</span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
