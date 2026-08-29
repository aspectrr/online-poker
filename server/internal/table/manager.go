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

// NewManager takes the concrete store so a nil *store.Store doesn't become
// a typed-nil Persister interface (which would panic on first InsertHand).
func NewManager(st *store.Store) *Manager {
	m := &Manager{tables: map[string]*Table{}}
	if st != nil {
		m.persist = st
	}
	return m
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
