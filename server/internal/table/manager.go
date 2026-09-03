package table

import (
	"sync"
	"time"

	"github.com/aspectrr/online-poker/server/internal/store"
)

// Manager owns live tables, creating them lazily from store rows.
type Manager struct {
	mu      sync.Mutex
	tables  map[string]*Table
	persist Persister
	// DevMode enables dev-only client commands on created tables
	// (forced deals); set by DEV_AUTH servers.
	DevMode bool
}

// NewManager takes the Persister directly: pass a nil interface for no
// persistence (dev). Callers must not pass a typed-nil *store.Store (that
// becomes a non-nil interface and panics on first InsertHand).
func NewManager(persist Persister) *Manager {
	return &Manager{tables: map[string]*Table{}, persist: persist}
}

// Get returns the live table, creating it from the store row on first hit.
func (m *Manager) Get(row store.GameTable) *Table {
	m.mu.Lock()
	defer m.mu.Unlock()
	if t, ok := m.tables[row.ID]; ok {
		return t
	}
	t := New(row, m.persist, m.DevMode)
	m.tables[row.ID] = t
	return t
}

// Lookup returns the live table without creating one (nil when cold).
func (m *Manager) Lookup(id string) *Table {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.tables[id]
}

// Drop closes a live table and forgets it (table deleted from the store).
func (m *Manager) Drop(id string) {
	m.mu.Lock()
	t := m.tables[id]
	delete(m.tables, id)
	m.mu.Unlock()
	if t != nil {
		t.Close()
	}
}

// Sweep closes live tables that have had no clients for at least maxIdle
// and aren't mid-hand, returning their ids for store deletion.
func (m *Manager) Sweep(maxIdle time.Duration) []string {
	m.mu.Lock()
	var reaped []string
	var stale []*Table
	for id, t := range m.tables {
		if !t.Busy() && t.EmptyFor() >= maxIdle {
			stale = append(stale, t)
			delete(m.tables, id)
			reaped = append(reaped, id)
		}
	}
	m.mu.Unlock()
	for _, t := range stale {
		t.Close()
	}
	return reaped
}

// CloseAll stops every table goroutine (server shutdown).
func (m *Manager) CloseAll() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, t := range m.tables {
		t.Close()
	}
	m.tables = map[string]*Table{}
}
