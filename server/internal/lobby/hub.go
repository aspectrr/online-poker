// Package lobby: broadcast hub for the tables list. Clients observe; the
// server pushes the full list on change (no deltas — the list is small).
// Change detection is a snapshot diff on a ticker rather than hooks in the
// table engine: create/delete/reaper/seat changes all surface without the
// table package knowing about the lobby. At poker-night scale one list
// snapshot per tick is free; revisit only if table counts grow large.
package lobby

import (
	"bytes"
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/aspectrr/online-poker/server/internal/protocol"
	"github.com/aspectrr/online-poker/server/internal/ws"
)

// Hub holds lobby websocket clients and pushes snapshots on change.
type Hub struct {
	mu      sync.Mutex
	clients map[*ws.Client]struct{}
	last    []byte // last broadcast payload; nil = nothing sent yet
}

func NewHub() *Hub {
	return &Hub{clients: map[*ws.Client]struct{}{}}
}

// Attach registers a client and immediately sends the current snapshot so
// a freshly connected lobby renders without waiting for the next tick.
func (h *Hub) Attach(c *ws.Client, snapshot func() []protocol.LobbyTable) {
	h.mu.Lock()
	h.clients[c] = struct{}{}
	h.mu.Unlock()
	if msg, ok := h.build(snapshot); ok {
		c.TrySend(msg)
	}
}

// Detach removes a dead client (ws onClose).
func (h *Hub) Detach(c *ws.Client) {
	h.mu.Lock()
	delete(h.clients, c)
	h.mu.Unlock()
}

// Run ticks until stop is closed, broadcasting when the snapshot differs
// from the last one sent.
func (h *Hub) Run(snapshot func() []protocol.LobbyTable, every time.Duration, stop <-chan struct{}) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-stop:
			return
		case <-t.C:
			if msg, ok := h.build(snapshot); ok {
				h.broadcast(msg)
			}
		}
	}
}

// build marshals the snapshot; ok=false when unchanged or no clients.
func (h *Hub) build(snapshot func() []protocol.LobbyTable) (protocol.ServerMsg, bool) {
	h.mu.Lock()
	n := len(h.clients)
	h.mu.Unlock()
	if n == 0 {
		return protocol.ServerMsg{}, false
	}
	rows := snapshot()
	if rows == nil {
		rows = []protocol.LobbyTable{}
	}
	msg := protocol.ServerMsg{Type: "lobby", Lobby: rows}
	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("lobby: marshal: %v", err)
		return protocol.ServerMsg{}, false
	}
	h.mu.Lock()
	unchanged := h.last != nil && bytes.Equal(h.last, data)
	if !unchanged {
		h.last = data
	}
	h.mu.Unlock()
	if unchanged {
		return protocol.ServerMsg{}, false
	}
	return msg, true
}

func (h *Hub) broadcast(msg protocol.ServerMsg) {
	h.mu.Lock()
	clients := make([]*ws.Client, 0, len(h.clients))
	for c := range h.clients {
		clients = append(clients, c)
	}
	h.mu.Unlock()
	for _, c := range clients {
		c.TrySend(msg)
	}
}
