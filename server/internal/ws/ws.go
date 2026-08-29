// Package ws: per-table websocket client registry and connection pumps.
// One Client = one authenticated connection bound to one table. Message
// handling is injected (OnMessage) — this package only moves bytes.
package ws

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/aspectrr/online-poker/server/internal/protocol"
)

const (
	sendBuffer   = 64
	writeTimeout = 5 * time.Second
	readTimeout  = 10 * time.Minute // dead-conn detection; pings keep it warm
)

// Client is a single authenticated websocket connection.
type Client struct {
	conn    *websocket.Conn
	userID  string
	send    chan []byte
	mu      sync.RWMutex
	closed  bool
	onClose func(*Client)
	onMsg   func(*Client, protocol.ClientMsg)
}

// UserID of the authenticated connection owner.
func (c *Client) UserID() string { return c.userID }

func Upgrade(w http.ResponseWriter, r *http.Request, userID string, onMsg func(*Client, protocol.ClientMsg), onClose func(*Client)) *Client {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		// Vite dev server (localhost:5173) is a different origin; auth is
		// token-gated, so localhost patterns are safe to allow.
		OriginPatterns: []string{"localhost:*", "127.0.0.1:*"},
	})
	if err != nil {
		log.Printf("ws: upgrade: %v", err)
		return nil
	}
	c := &Client{
		conn:    conn,
		userID:  userID,
		send:    make(chan []byte, sendBuffer),
		onClose: onClose,
		onMsg:   onMsg,
	}
	go c.writePump()
	go c.readPump()
	return c
}

// readPump: one goroutine per connection. Delivers decoded ClientMsgs to
// the injected handler; any error ends the connection.
func (c *Client) readPump() {
	defer c.shutdown()
	ctx, cancel := context.WithTimeout(context.Background(), readTimeout)
	defer cancel()
	for {
		_, data, err := c.conn.Read(ctx)
		if err != nil {
			return
		}
		var msg protocol.ClientMsg
		if err := json.Unmarshal(data, &msg); err != nil {
			c.TrySend(protocol.ServerMsg{Type: "error", Error: "bad json"})
			continue
		}
		c.onMsg(c, msg)
	}
}

// writePump drains the buffered send channel until the client dies.
func (c *Client) writePump() {
	for {
		c.mu.RLock()
		closed := c.closed
		c.mu.RUnlock()
		if closed {
			return
		}
		data, ok := <-c.send
		if !ok {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), writeTimeout)
		err := c.conn.Write(ctx, websocket.MessageText, data)
		cancel()
		if err != nil {
			c.shutdown()
			return
		}
	}
}

// TrySend enqueues without blocking. Returns false when the buffer is
// full. Safe after shutdown: a dropped-closed race returns false instead
// of panicking (send on closed channel is recoverable but ugly — we guard
// with a closed flag instead).
func (c *Client) TrySend(msg protocol.ServerMsg) (ok bool) {
	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("ws: marshal: %v", err)
		return false
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.closed {
		return false
	}
	select {
	case c.send <- data:
		return true
	default:
		return false // slow client: message dropped, not conn-killed
	}
}

// NewTestClient builds a pump-less client for tests: TrySend enqueues;
// tests read via RecvMsgs. A real close of a test client must not call
// shutdown twice (TrySend on full buffer would) — tests skip shutdown.
func NewTestClient(userID string) *Client {
	return &Client{userID: userID, send: make(chan []byte, 256)}
}

// RecvMsgs: test hook — snapshot of queued outbound messages.
func (c *Client) RecvMsgs() [][]byte {
	var out [][]byte
	for {
		select {
		case data := <-c.send:
			out = append(out, data)
		default:
			return out
		}
	}
}

// shutdown closes the conn and marks the client dead exactly once.
// send is never closed — TrySend guards with the flag; the channel is GC'd
// with the client. Closing it raced against in-flight broadcasts.
func (c *Client) shutdown() {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return
	}
	c.closed = true
	c.mu.Unlock()
	if c.conn != nil {
		c.conn.Close(websocket.StatusNormalClosure, "")
	}
	if c.onClose != nil {
		c.onClose(c)
	}
}
