package engine

import (
	"testing"

	"github.com/chehsunliu/poker"
)

// ASPTR-184: hand-rolled evaluator vs github.com/chehsunliu/poker (deuces-port
// lookup tables). Same 7 cards on both sides. The lib has no Omaha/PLO support,
// so PLO is hand-rolled only.

var bench7 = [7]Card{
	NewCard(RankA, 0), // As
	NewCard(11, 2),    // Kd
	NewCard(8, 1),     // Th
	NewCard(6, 3),     // 8c
	NewCard(4, 0),     // 6s
	NewCard(2, 1),     // 4h
	NewCard(1, 2),     // 3d
}

func libCard(s string) poker.Card {
	c := poker.NewCard(s)
	if c == poker.Card(0) && s != "2s" {
		panic("bad card " + s)
	}
	return c
}

func BenchmarkEval5(b *testing.B) {
	var h [5]Card
	copy(h[:], bench7[:5])
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		eval5(h)
	}
}

func BenchmarkEvaluate7HandRolled(b *testing.B) {
	for i := 0; i < b.N; i++ {
		Evaluate7(bench7)
	}
}

func BenchmarkEvaluate7Chehsunliu(b *testing.B) {
	lib := []poker.Card{
		libCard("As"), libCard("Kd"), libCard("Th"),
		libCard("8c"), libCard("6s"), libCard("4h"), libCard("3d"),
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		poker.Evaluate(lib)
	}
}

func BenchmarkEvaluatePLOHandRolled(b *testing.B) {
	hole := [4]Card{NewCard(RankA, 0), NewCard(11, 2), NewCard(8, 1), NewCard(6, 3)}
	board := [5]Card{NewCard(4, 0), NewCard(2, 1), NewCard(1, 2), NewCard(0, 3), NewCard(0, 1)}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		EvaluatePLO(hole, board)
	}
}
