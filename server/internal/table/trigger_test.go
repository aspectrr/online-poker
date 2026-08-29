package table

import (
	"testing"

	"github.com/aspectrr/online-poker/server/internal/engine"
	"github.com/aspectrr/online-poker/server/internal/store"
)

func intP(i int) *int { return &i }

// dev-table config: bomb_pot_triggers=[{rank:12}] (a queen, store ranks 2-14).
func TestTriggerConfigWired(t *testing.T) {
	row := store.GameTable{ID: "x", GameType: "NLHE", Config: store.TableConfig{
		BombPotTriggers: []store.BombPotTrigger{{Rank: intP(12)}},
	}}
	cfg := engineConfig(row)
	if len(cfg.BombPotCardTriggers) != 1 {
		t.Fatalf("triggers len = %d, want 1", len(cfg.BombPotCardTriggers))
	}
	tr := cfg.BombPotCardTriggers[0]
	// queen hearts: engine rank 10 (= store 12), suit 1
	qh := engine.NewCard(10, 1)
	if !tr.Matches(qh) {
		t.Fatalf("trigger should match queen of hearts (%d rank %d)", qh, qh.Rank())
	}
	if tr.Matches(engine.NewCard(8, 2)) {
		t.Fatal("trigger should not match ten of diamonds")
	}
	if !engine.AnyTriggerMatch(cfg.BombPotCardTriggers, []engine.Card{engine.NewCard(5, 0), qh}) {
		t.Fatal("AnyTriggerMatch should find the queen")
	}
}
