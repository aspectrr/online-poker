package engine

import (
	"strings"
	"testing"
)

// ---- deterministic deck helpers ----

// stackedDeck: deck whose cards come off in listed order (top first).
type stackedDeck struct {
	Deck
}

func newStacked(cards []Card) Deck {
	var d Deck
	// cards[0] must come off first; Draw slices from the tail, so reverse.
	for i, c := range cards {
		d.cards[len(cards)-1-i] = c
	}
	d.remaining = len(cards)
	return d
}

// fullStackedDeck: 52 cards in the exact given order (index 0 dealt first).
func fullStackedDeck(t *testing.T, order []Card) Deck {
	t.Helper()
	if len(order) != 52 {
		t.Fatalf("need 52 cards, got %d", len(order))
	}
	return newStacked(order)
}

// cardsFrom builds a card list from strings like "As", "7c", "Td".
func cardsFrom(t *testing.T, ss ...string) []Card {
	t.Helper()
	out := make([]Card, len(ss))
	for i, s := range ss {
		r := rankIndex(s[0])
		su := suitIndex(s[1])
		out[i] = NewCard(r, su)
	}
	return out
}

func rankIndex(c byte) int { return strings.IndexByte("23456789TJQKA", c) }
func suitIndex(c byte) int { return strings.IndexByte("shdc", c) }

// padTo52: append remaining deck (unused ranks) after the meaningful prefix
// so Draw never underflows. Returns 52 unique cards.
func padTo52(t *testing.T, prefix []Card) []Card {
	t.Helper()
	seen := map[Card]bool{}
	for _, c := range prefix {
		if seen[c] {
			t.Fatalf("duplicate card %s in prefix", c)
		}
		seen[c] = true
	}
	out := append([]Card{}, prefix...)
	for c := Card(0); c < 52 && len(out) < 52; c++ {
		if !seen[c] {
			out = append(out, c)
			seen[c] = true
		}
	}
	return out
}

func baseCfg() TableConfig {
	return TableConfig{
		Game:       NLHE,
		SmallBlind: 50,
		BigBlind:   100,
	}
}

func seats2() []SeatState {
	return []SeatState{
		{Seat: 0, Player: "A", Stack: 10000},
		{Seat: 1, Player: "B", Stack: 10000},
	}
}

// act: apply one action and fail on error.
func act(t *testing.T, r *HandRunner, a Action) []Event {
	t.Helper()
	evs, err := r.Advance(&a)
	if err != nil {
		t.Fatalf("action %+v: %v", a, err)
	}
	return evs
}

func tick(t *testing.T, r *HandRunner) []Event {
	t.Helper()
	evs, err := r.Advance(nil)
	if err != nil {
		t.Fatalf("tick: %v", err)
	}
	return evs
}

// runTo: tick until hand done (applies no actions).
func runTo(t *testing.T, r *HandRunner) []Event {
	t.Helper()
	var evs []Event
	for i := 0; i < 50 && !r.Done(); i++ {
		evs = append(evs, tick(t, r)...)
	}
	if !r.Done() {
		t.Fatal("hand did not finish in 50 ticks")
	}
	return evs
}

func findStack(t *testing.T, evs []Event, seat int) int64 {
	t.Helper()
	var last FinalStack
	for _, e := range evs {
		for _, s := range e.Stacks {
			if s.Seat == seat {
				last = s
			}
		}
	}
	if last.Player == "" && last.Stack == 0 {
		t.Fatalf("no final stack for seat %d", seat)
	}
	return last.Stack
}

func wonTotal(t *testing.T, evs []Event, seat int) int64 {
	t.Helper()
	var total int64
	for _, e := range evs {
		if e.Type == EvPotAwarded && e.Seat == seat {
			total += e.Amount
		}
		if e.Type == EvSevenDeuceBounty && e.To == 0 {
			// bounty events: payer seat; winner gains tracked via stacks
		}
	}
	return total
}

// ---- card / deck tests ----

func TestDeckShuffleAndDraw(t *testing.T) {
	d, err := NewDeck()
	if err != nil {
		t.Fatal(err)
	}
	seen := map[Card]bool{}
	for i := 0; i < 52; i++ {
		c, err := d.Draw(1)
		if err != nil {
			t.Fatalf("draw %d: %v", i, err)
		}
		if seen[c[0]] {
			t.Fatalf("duplicate card %s", c[0])
		}
		seen[c[0]] = true
	}
	if _, err := d.Draw(1); err == nil {
		t.Fatal("expected draw error on empty deck")
	}
}

func TestCardBasics(t *testing.T) {
	as := NewCard(12, 0)
	if as.Rank() != 12 || as.Suit() != 0 || as.Color() != 0 || as.String() != "As" {
		t.Fatalf("As: %+v", as)
	}
	kh := NewCard(11, 1)
	if kh.Color() != 1 || kh.String() != "Kh" {
		t.Fatalf("Kh: %+v", kh)
	}
}

func TestCardTriggerMatching(t *testing.T) {
	seven := 5
	exact := NewCard(5, 2) // 7d
	rcRed := &struct {
		Rank  int
		Color int
	}{Rank: 5, Color: 1}

	cases := []struct {
		name    string
		trig    CardTrigger
		card    Card
		want    bool
		wantErr bool
	}{
		{"rank any suit", CardTrigger{RankOnly: &seven}, NewCard(5, 3), true, false},
		{"rank mismatch", CardTrigger{RankOnly: &seven}, NewCard(6, 3), false, false},
		{"exact hit", CardTrigger{ExactCard: &exact}, NewCard(5, 2), true, false},
		{"exact suit mismatch", CardTrigger{ExactCard: &exact}, NewCard(5, 3), false, false},
		{"rank color red hit", CardTrigger{RankColor: rcRed}, NewCard(5, 1), true, false},
		{"rank color black miss", CardTrigger{RankColor: rcRed}, NewCard(5, 0), false, false},
		{"empty trigger", CardTrigger{}, NewCard(5, 0), false, true},
		{"two patterns", CardTrigger{RankOnly: &seven, ExactCard: &exact}, NewCard(5, 0), false, true},
		{"rank out of range", CardTrigger{RankOnly: ptrInt(13)}, NewCard(5, 0), false, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.trig.Validate()
			if tc.wantErr {
				if err == nil {
					t.Fatal("expected validation error")
				}
				return
			}
			if err != nil {
				t.Fatalf("validate: %v", err)
			}
			if got := tc.trig.Matches(tc.card); got != tc.want {
				t.Fatalf("Matches(%s) = %v, want %v", tc.card, got, tc.want)
			}
		})
	}
}

func ptrInt(i int) *int { return &i }

func TestAnyTriggerMatch(t *testing.T) {
	five := 3
	trigs := []CardTrigger{{RankOnly: &five}}
	if !AnyTriggerMatch(trigs, []Card{NewCard(0, 0), NewCard(3, 2)}) {
		t.Fatal("expected match on 5d")
	}
	if AnyTriggerMatch(trigs, []Card{NewCard(0, 0), NewCard(9, 2)}) {
		t.Fatal("unexpected match")
	}
}
