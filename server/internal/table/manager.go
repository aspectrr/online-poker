package table

import (
	"sync"

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

// CloseAll stops every table goroutine (server shutdown).
func (m *Manager) CloseAll() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, t := range m.tables {
		t.Close()
	}
	m.tables = map[string]*Table{}
}
