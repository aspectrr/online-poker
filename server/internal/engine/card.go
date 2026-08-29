package engine

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"strconv"
)

// Card: 0..51. Rank = c>>2 (0=2..12=A), Suit = c&3 (0=s 1=h 2=d 3=c).
type Card uint8

const (
	Rank7 = 5
	Rank2 = 0
	RankA = 12
)

func NewCard(rank, suit int) Card { return Card(rank*4 + suit) }

func (c Card) Rank() int { return int(c) >> 2 }
func (c Card) Suit() int { return int(c) & 3 }

// MarshalJSON: cards are plain numbers on the wire ([]Card would otherwise
// base64-encode as if it were []byte).
func (c Card) MarshalJSON() ([]byte, error) { return []byte(strconv.Itoa(int(c))), nil }

// UnmarshalJSON reads a JSON number back into a Card.
func (c *Card) UnmarshalJSON(b []byte) error {
	n, err := strconv.Atoi(string(b))
	if err != nil {
		return fmt.Errorf("card: expected number, got %s", b)
	}
	*c = Card(n)
	return nil
}

func (c Card) String() string {
	return fmt.Sprintf("%c%c", "23456789TJQKA"[c.Rank()], "shdc"[c.Suit()])
}

// Color: 0 = black (spades, clubs), 1 = red (hearts, diamonds).
func (c Card) Color() int {
	if c.Suit() == 1 || c.Suit() == 2 {
		return 1
	}
	return 0
}

// Deck: 52 cards, Fisher-Yates shuffled with crypto/rand. Draw consumes from top.
type Deck struct {
	cards     [52]Card
	remaining int
}

func NewDeck() (Deck, error) {
	var d Deck
	for i := range d.cards {
		d.cards[i] = Card(i)
	}
	d.remaining = 52
	for i := 51; i > 0; i-- {
		jBig, err := rand.Int(rand.Reader, big.NewInt(int64(i+1)))
		if err != nil {
			return d, fmt.Errorf("shuffle: %w", err)
		}
		j := int(jBig.Int64())
		d.cards[i], d.cards[j] = d.cards[j], d.cards[i]
	}
	return d, nil
}

func (d *Deck) Draw(n int) ([]Card, error) {
	if n > d.remaining {
		return nil, fmt.Errorf("draw %d, only %d left", n, d.remaining)
	}
	cards := make([]Card, n)
	copy(cards, d.cards[d.remaining-n:d.remaining])
	d.remaining -= n
	return cards, nil
}

func (d *Deck) Peek(n int) []Card {
	hi := d.remaining - n
	if hi < 0 {
		hi = 0
	}
	out := make([]Card, d.remaining-hi)
	copy(out, d.cards[hi:d.remaining])
	return out
}
