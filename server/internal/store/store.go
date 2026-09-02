// Package store persists game tables and hands in Postgres (Supabase).
package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// BombPotTrigger deals a bomb pot when the next card matches.
// rank: 2-14, suit: 0-3 or nil, color: "red"/"black" or nil.
type BombPotTrigger struct {
	Rank  *int    `json:"rank"`
	Suit  *int    `json:"suit"`
	Color *string `json:"color"`
}

// TableConfig is the game_tables.config jsonb payload.
type TableConfig struct {
	BlindsSBBB       []int64          `json:"blinds_sb_bb"` // [sb, bb] in cents
	StartingStackBB  int              `json:"starting_stack_bb"`
	ActionTimeoutS   int              `json:"action_timeout_s"`
	InterHandDelayS  int              `json:"inter_hand_delay_s"`
	RIT              string           `json:"rit"` // never | always
	RabbitHunt       bool             `json:"rabbit_hunt"`
	BombPotMode      string           `json:"bomb_pot_mode"` // off | manual | trigger
	BombPotAntes     int64            `json:"bomb_pot_antes"`
	BombPotTriggers  []BombPotTrigger `json:"bomb_pot_triggers"`
	SevenDeuce       bool             `json:"seven_deuce"`
	SevenDeuceBounty int64            `json:"seven_deuce_bounty"`
	TexasDropAnte    int64            `json:"texas_drop_ante,omitempty"` // Texas Drop ante, cents; 0 = house default 2.5×BB
	MaxSeats         int              `json:"max_seats"`
}

// Validate checks config invariants. Defaults applied for zero fields
// where the UI sends partial config; invalid combos are an error.
func (c *TableConfig) Validate() error {
	if len(c.BlindsSBBB) != 2 {
		return fmt.Errorf("blinds_sb_bb must be [sb, bb], got %d entries", len(c.BlindsSBBB))
	}
	sb, bb := c.BlindsSBBB[0], c.BlindsSBBB[1]
	if sb <= 0 || bb <= 0 {
		return fmt.Errorf("blinds must be positive, got sb=%d bb=%d", sb, bb)
	}
	if sb > bb {
		return fmt.Errorf("sb (%d) must be <= bb (%d)", sb, bb)
	}
	if c.StartingStackBB <= 0 {
		return fmt.Errorf("starting_stack_bb must be positive, got %d", c.StartingStackBB)
	}
	if c.ActionTimeoutS < 5 || c.ActionTimeoutS > 300 {
		return fmt.Errorf("action_timeout_s must be 5-300, got %d", c.ActionTimeoutS)
	}
	if c.InterHandDelayS < 5 || c.InterHandDelayS > 300 {
		return fmt.Errorf("inter_hand_delay_s must be 5-300, got %d", c.InterHandDelayS)
	}
	switch c.RIT {
	case "", "never", "always":
	default:
		return fmt.Errorf("rit must be never or always, got %q", c.RIT)
	}
	switch c.BombPotMode {
	case "", "off", "manual", "trigger":
	default:
		return fmt.Errorf("bomb_pot_mode must be off, manual or trigger, got %q", c.BombPotMode)
	}
	if c.BombPotAntes < 0 {
		return fmt.Errorf("bomb_pot_antes must be >= 0, got %d", c.BombPotAntes)
	}
	if c.BombPotMode == "trigger" && len(c.BombPotTriggers) == 0 {
		return fmt.Errorf("bomb_pot_mode=trigger requires at least one trigger")
	}
	for i, t := range c.BombPotTriggers {
		if t.Rank == nil || *t.Rank < 2 || *t.Rank > 14 {
			return fmt.Errorf("bomb_pot_triggers[%d].rank must be 2-14", i)
		}
		if t.Suit != nil && (*t.Suit < 0 || *t.Suit > 3) {
			return fmt.Errorf("bomb_pot_triggers[%d].suit must be 0-3", i)
		}
		if t.Color != nil && *t.Color != "red" && *t.Color != "black" {
			return fmt.Errorf("bomb_pot_triggers[%d].color must be red or black", i)
		}
	}
	if c.SevenDeuceBounty < 0 {
		return fmt.Errorf("seven_deuce_bounty must be >= 0, got %d", c.SevenDeuceBounty)
	}
	if c.TexasDropAnte < 0 {
		return fmt.Errorf("texas_drop_ante must be >= 0, got %d", c.TexasDropAnte)
	}
	if c.MaxSeats <= 0 {
		return fmt.Errorf("max_seats must be positive, got %d", c.MaxSeats)
	}
	if c.MaxSeats > 22 {
		return fmt.Errorf("max_seats must be <= 22, got %d", c.MaxSeats)
	}
	return nil
}

// ApplyDefaults fills zero fields with sensible poker values so callers
// can send partial config. Called before Validate.
func (c *TableConfig) ApplyDefaults() {
	if c.ActionTimeoutS == 0 {
		c.ActionTimeoutS = 15
	}
	if c.RIT == "" {
		c.RIT = "never"
	}
	if c.BombPotMode == "" {
		c.BombPotMode = "off"
	}
	if c.MaxSeats == 0 {
		c.MaxSeats = 9
	}
}

// GameTable is a row in game_tables.
type GameTable struct {
	ID        string
	Name      string
	GameType  string
	Config    TableConfig
	CreatedBy *string // nil = system-created
	CreatedAt time.Time
}

// Hand is a row in hands. Data is the raw hand-history jsonb.
type Hand struct {
	ID        int64
	TableID   string
	HandNo    int
	Data      json.RawMessage
	CreatedAt time.Time
}

// Store wraps a pgx connection pool.
type Store struct {
	pool *pgxpool.Pool
}

// New connects to databaseURL (Supabase pooler/service connection string).
func New(ctx context.Context, databaseURL string) (*Store, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("store: connect: %w", err)
	}
	return &Store{pool: pool}, nil
}

// Close closes the pool.
func (s *Store) Close() { s.pool.Close() }

// CreateTable validates config and inserts a game table, returning the row.
func (s *Store) CreateTable(ctx context.Context, name, gameType string, cfg TableConfig, createdBy *string) (*GameTable, error) {
	cfg.ApplyDefaults()
	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("store: invalid config: %w", err)
	}
	cfgJSON, err := json.Marshal(cfg)
	if err != nil {
		return nil, fmt.Errorf("store: marshal config: %w", err)
	}
	row := s.pool.QueryRow(ctx,
		`insert into game_tables (name, game_type, config, created_by) values ($1, $2, $3, $4)
		 returning id, name, game_type, config, created_by, created_at`,
		name, gameType, cfgJSON, createdBy)
	var t GameTable
	var rawCfg []byte
	if err := row.Scan(&t.ID, &t.Name, &t.GameType, &rawCfg, &t.CreatedBy, &t.CreatedAt); err != nil {
		return nil, fmt.Errorf("store: insert game_tables: %w", err)
	}
	if err := json.Unmarshal(rawCfg, &t.Config); err != nil {
		return nil, fmt.Errorf("store: unmarshal config: %w", err)
	}
	return &t, nil
}

// ListTables returns all tables, newest first.
func (s *Store) ListTables(ctx context.Context) ([]GameTable, error) {
	rows, err := s.pool.Query(ctx,
		`select id, name, game_type, config, created_by, created_at from game_tables order by created_at desc`)
	if err != nil {
		return nil, fmt.Errorf("store: list game_tables: %w", err)
	}
	defer rows.Close()
	var out []GameTable
	for rows.Next() {
		var t GameTable
		var rawCfg []byte
		if err := rows.Scan(&t.ID, &t.Name, &t.GameType, &rawCfg, &t.CreatedBy, &t.CreatedAt); err != nil {
			return nil, fmt.Errorf("store: scan game_tables: %w", err)
		}
		if err := json.Unmarshal(rawCfg, &t.Config); err != nil {
			return nil, fmt.Errorf("store: unmarshal config: %w", err)
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

var ErrNotFound = errors.New("store: not found")

// GetTable returns one table by id.
func (s *Store) GetTable(ctx context.Context, id string) (*GameTable, error) {
	row := s.pool.QueryRow(ctx,
		`select id, name, game_type, config, created_by, created_at from game_tables where id = $1`, id)
	var t GameTable
	var rawCfg []byte
	if err := row.Scan(&t.ID, &t.Name, &t.GameType, &rawCfg, &t.CreatedBy, &t.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("store: get game_tables: %w", err)
	}
	if err := json.Unmarshal(rawCfg, &t.Config); err != nil {
		return nil, fmt.Errorf("store: unmarshal config: %w", err)
	}
	return &t, nil
}

// InsertHand appends a hand history row.
func (s *Store) InsertHand(ctx context.Context, tableID string, handNo int, data json.RawMessage) (*Hand, error) {
	row := s.pool.QueryRow(ctx,
		`insert into hands (table_id, hand_no, data) values ($1, $2, $3)
		 returning id, table_id, hand_no, data, created_at`,
		tableID, handNo, []byte(data))
	var h Hand
	var rawData []byte
	if err := row.Scan(&h.ID, &h.TableID, &h.HandNo, &rawData, &h.CreatedAt); err != nil {
		return nil, fmt.Errorf("store: insert hands: %w", err)
	}
	h.Data = rawData
	return &h, nil
}

// ListHands returns the most recent `limit` hands for a table, newest first.
func (s *Store) ListHands(ctx context.Context, tableID string, limit int) ([]Hand, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.pool.Query(ctx,
		`select id, table_id, hand_no, data, created_at from hands
		 where table_id = $1 order by hand_no desc limit $2`, tableID, limit)
	if err != nil {
		return nil, fmt.Errorf("store: list hands: %w", err)
	}
	defer rows.Close()
	var out []Hand
	for rows.Next() {
		var h Hand
		var rawData []byte
		if err := rows.Scan(&h.ID, &h.TableID, &h.HandNo, &rawData, &h.CreatedAt); err != nil {
			return nil, fmt.Errorf("store: scan hands: %w", err)
		}
		h.Data = rawData
		out = append(out, h)
	}
	return out, rows.Err()
}
