package store

import (
	"encoding/json"
	"testing"
)

func intp(i int) *int         { return &i }
func strp(s string) *string   { return &s }

func validConfig() TableConfig {
	return TableConfig{
		BlindsSBBB:      []int64{25, 50},
		StartingStackBB: 200,
		ActionTimeoutS:  30,
		InterHandDelayS: 10,
		MaxSeats:        9,
	}
}

func TestValidateOK(t *testing.T) {
	cases := []struct {
		name string
		mut  func(*TableConfig)
	}{
		{"plain", func(c *TableConfig) {}},
		{"sb equals bb", func(c *TableConfig) { c.BlindsSBBB = []int64{50, 50} }},
		{"min timeouts", func(c *TableConfig) { c.ActionTimeoutS, c.InterHandDelayS = 5, 5 }},
		{"max timeouts", func(c *TableConfig) { c.ActionTimeoutS, c.InterHandDelayS = 300, 300 }},
		{"zero bounty ok", func(c *TableConfig) { c.SevenDeuce = true; c.SevenDeuceBounty = 0 }},
		{
			"trigger w/ full match",
			func(c *TableConfig) {
				c.BombPotMode = "trigger"
				c.BombPotTriggers = []BombPotTrigger{{Rank: intp(7), Suit: intp(0), Color: strp("black")}}
			},
		},
		{
			"trigger rank only",
			func(c *TableConfig) {
				c.BombPotMode = "trigger"
				c.BombPotTriggers = []BombPotTrigger{{Rank: intp(2)}}
			},
		},
		{"6max", func(c *TableConfig) { c.MaxSeats = 6 }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := validConfig()
			tc.mut(&c)
			c.ApplyDefaults()
			if err := c.Validate(); err != nil {
				t.Fatalf("expected valid, got %v", err)
			}
		})
	}
}

func TestValidateErrors(t *testing.T) {
	cases := []struct {
		name string
		mut  func(*TableConfig)
	}{
		{"sb > bb", func(c *TableConfig) { c.BlindsSBBB = []int64{100, 50} }},
		{"zero bb", func(c *TableConfig) { c.BlindsSBBB = []int64{50, 0} }},
		{"wrong arity", func(c *TableConfig) { c.BlindsSBBB = []int64{50} }},
		{"timeout too low", func(c *TableConfig) { c.ActionTimeoutS = 4 }},
		{"timeout too high", func(c *TableConfig) { c.ActionTimeoutS = 301 }},
		{"delay too low", func(c *TableConfig) { c.InterHandDelayS = 1 }},
		{"delay too high", func(c *TableConfig) { c.InterHandDelayS = 999 }},
		{"bad rit", func(c *TableConfig) { c.RIT = "sometimes" }},
		{"bad bomb pot mode", func(c *TableConfig) { c.BombPotMode = "sometimes" }},
		{"negative antes", func(c *TableConfig) { c.BombPotAntes = -1 }},
		{
			"trigger mode without triggers",
			func(c *TableConfig) { c.BombPotMode = "trigger" },
		},
		{
			"trigger rank too low",
			func(c *TableConfig) {
				c.BombPotMode = "trigger"
				c.BombPotTriggers = []BombPotTrigger{{Rank: intp(1)}}
			},
		},
		{
			"trigger rank too high",
			func(c *TableConfig) {
				c.BombPotMode = "trigger"
				c.BombPotTriggers = []BombPotTrigger{{Rank: intp(15)}}
			},
		},
		{
			"trigger bad suit",
			func(c *TableConfig) {
				c.BombPotMode = "trigger"
				c.BombPotTriggers = []BombPotTrigger{{Rank: intp(7), Suit: intp(4)}}
			},
		},
		{
			"trigger bad color",
			func(c *TableConfig) {
				c.BombPotMode = "trigger"
				c.BombPotTriggers = []BombPotTrigger{{Rank: intp(7), Color: strp("green")}}
			},
		},
		{"negative bounty", func(c *TableConfig) { c.SevenDeuceBounty = -5 }},
		{"too many seats", func(c *TableConfig) { c.MaxSeats = 23 }},
		{"zero stack", func(c *TableConfig) { c.StartingStackBB = 0 }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := validConfig()
			tc.mut(&c)
			c.ApplyDefaults()
			if err := c.Validate(); err == nil {
				t.Fatal("expected error, got nil")
			}
		})
	}
}

func TestApplyDefaults(t *testing.T) {
	c := TableConfig{BlindsSBBB: []int64{25, 50}, StartingStackBB: 100}
	c.ApplyDefaults()
	if c.RIT != "never" || c.BombPotMode != "off" || c.MaxSeats != 9 {
		t.Fatalf("defaults not applied: %+v", c)
	}
}

func TestConfigJSONRoundTrip(t *testing.T) {
	// Wire format must match the JSON tags used by web + engine.
	in := `{
		"blinds_sb_bb": [25, 50],
		"starting_stack_bb": 200,
		"action_timeout_s": 30,
		"inter_hand_delay_s": 10,
		"rit": "never",
		"rabbit_hunt": true,
		"bomb_pot_mode": "trigger",
		"bomb_pot_antes": 150,
		"bomb_pot_triggers": [{"rank": 7, "suit": 0, "color": "black"}],
		"seven_deuce": true,
		"seven_deuce_bounty": 500,
		"max_seats": 6
	}`
	var c TableConfig
	if err := json.Unmarshal([]byte(in), &c); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(c.BlindsSBBB) != 2 || c.BlindsSBBB[0] != 25 || c.BlindsSBBB[1] != 50 {
		t.Fatalf("blinds: %+v", c.BlindsSBBB)
	}
	if !c.RabbitHunt || !c.SevenDeuce {
		t.Fatalf("bools: %+v", c)
	}
	if len(c.BombPotTriggers) != 1 || c.BombPotTriggers[0].Rank == nil || *c.BombPotTriggers[0].Rank != 7 {
		t.Fatalf("triggers: %+v", c.BombPotTriggers)
	}
	out, err := json.Marshal(c)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var back TableConfig
	if err := json.Unmarshal(out, &back); err != nil {
		t.Fatalf("re-unmarshal: %v", err)
	}
	if back.BombPotAntes != c.BombPotAntes || back.MaxSeats != c.MaxSeats {
		t.Fatalf("round trip mismatch: %+v vs %+v", back, c)
	}
}
