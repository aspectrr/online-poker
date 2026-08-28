package engine

import "testing"

// Random full hands: chip conservation + termination across many configs.
func TestRandomHandsConservation(t *testing.T) {
	cases := []struct {
		name string
		cfg  TableConfig
	}{
		{"nlhe", baseCfg()},
		{"plo", func() TableConfig { c := baseCfg(); c.Game = PLO4; return c }()},
		{"rit", func() TableConfig { c := baseCfg(); c.RunItTwice = RITAlways; return c }()},
		{"bombpot", func() TableConfig { c := baseCfg(); c.BombPot = true; return c }()},
		{"72", func() TableConfig {
			c := baseCfg()
			c.SevenDeuce = SevenDeuceConfig{Enabled: true, Amount: 250}
			return c
		}()},
		{"ante", func() TableConfig { c := baseCfg(); c.Ante = 25; return c }()},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			for trial := 0; trial < 300; trial++ {
				seats := randomSeats(t)
				var total int64
				for _, s := range seats {
					total += s.Stack
				}
				r, err := startHand(tc.cfg, seats, mustDeck(t))
				if err != nil {
					t.Fatalf("trial %d: %v", trial, err)
				}
				var evs []Event
				evs = append(evs, tick(t, r)...)
				for i := 0; i < 200 && !r.Done(); i++ {
					la := r.LegalActionsFor()
					if la == nil {
						// post-hand decisions
						if r.postHandPending() {
							a := randomPostHand(r)
							more, err := r.Advance(a)
							if err != nil {
								t.Fatalf("posthand: %v", err)
							}
							evs = append(evs, more...)
							continue
						}
						evs = append(evs, tick(t, r)...)
						continue
					}
					more, err := r.Advance(randomAction(la))
					if err != nil {
						t.Fatalf("trial %d: %v (la=%+v)", trial, err, la)
					}
					evs = append(evs, more...)
				}
				if !r.Done() {
					t.Fatalf("trial %d: hand did not terminate", trial)
				}
				// flush remaining post-hand decision
				if r.postHandPending() {
					more, err := r.Advance(randomPostHand(r))
					if err != nil {
						t.Fatalf("final posthand: %v", err)
					}
					evs = append(evs, more...)
				}
				var got int64
				for _, s := range r.Stacks() {
					got += s.Stack
				}
				if got != total {
					t.Fatalf("trial %d: chips %d != %d", trial, got, total)
				}
			}
		})
	}
}

func randomSeats(t *testing.T) []SeatState {
	t.Helper()
	n := 2 + deterministicRand(t)%8
	seats := make([]SeatState, n)
	for i := range seats {
		seats[i] = SeatState{
			Seat:   i,
			Player: "p",
			Stack:  int64(200 + deterministicRand(t)%9800),
		}
	}
	return seats
}

var randCounter uint64 = 12345

func deterministicRand(t *testing.T) uint64 {
	t.Helper()
	randCounter = randCounter*6364136223846793005 + 1442695040888963407
	return randCounter >> 33
}

func randomAction(la *LegalActions) *Action {
	switch deterministicRandHelper(la) {
	case 0:
		return &Action{Seat: la.Seat, Kind: Fold}
	case 1:
		if la.CanCheck {
			return &Action{Seat: la.Seat, Kind: Check}
		}
		if la.CanCall {
			return &Action{Seat: la.Seat, Kind: Call}
		}
		return &Action{Seat: la.Seat, Kind: Fold}
	case 2:
		if la.CanCall {
			return &Action{Seat: la.Seat, Kind: Call}
		}
		return &Action{Seat: la.Seat, Kind: Check}
	default:
		if la.CanRaise {
			to := la.MinRaiseTo
			if la.MaxRaiseTo > la.MinRaiseTo {
				to += int64(deterministicRandHelper(la)) % (la.MaxRaiseTo - la.MinRaiseTo + 1)
			}
			return &Action{Seat: la.Seat, Kind: Raise, Amount: to}
		}
		if la.CanCall {
			return &Action{Seat: la.Seat, Kind: Call}
		}
		return &Action{Seat: la.Seat, Kind: Check}
	}
}

func deterministicRandHelper(la *LegalActions) uint64 {
	randCounter = randCounter*6364136223846793005 + 1442695040888963407
	return (randCounter >> 33) % 4
}

func (r *HandRunner) postHandPending() bool {
	return r.pendingRevealIdx >= 0 || r.rabbitAvailable
}

func randomPostHand(r *HandRunner) *Action {
	if r.pendingRevealIdx >= 0 {
		seat := r.players[r.pendingRevealIdx].seat
		randCounter = randCounter*6364136223846793005 + 1442695040888963407
		if (randCounter>>33)%2 == 0 {
			return &Action{Seat: seat, Kind: Reveal}
		}
		return &Action{Seat: seat, Kind: Muck}
	}
	// rabbit: need the deciding seat; use last winner (seat with pot_awarded)
	// simple: try seat 0; engine validates
	return &Action{Seat: 0, Kind: Muck}
}
