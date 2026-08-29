package ws_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/aspectrr/online-poker/server/internal/protocol"
	"github.com/aspectrr/online-poker/server/internal/store"
	"github.com/aspectrr/online-poker/server/internal/table"
	"github.com/aspectrr/online-poker/server/internal/ws"
)

// fake auth: any bearer token maps to itself as uid.
func fakeAuth(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tok := r.Header.Get("Authorization")
		tok = strings.TrimPrefix(tok, "Bearer ")
		if tok == "" {
			tok = r.URL.Query().Get("token")
		}
		if tok == "" {
			http.Error(w, "no token", 401)
			return
		}
		h.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, tok)))
	})
}

type ctxKey struct{}

func uid(r *http.Request) string { v, _ := r.Context().Value(ctxKey{}).(string); return v }

func dial(t *testing.T, url, token string) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, url+"?token="+token, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	return c
}

func readMsg(t *testing.T, c *websocket.Conn) protocol.ServerMsg {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, data, err := c.Read(ctx)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	var m protocol.ServerMsg
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatalf("unmarshal %s: %v", data, err)
	}
	return m
}

// TestEndToEnd: two players join over real websockets, hand starts on
// __start_hand, both get holes, one folds, other wins.
func setup(t *testing.T, startDelay time.Duration) (*table.Manager, *http.ServeMux) {
	mgr := table.NewManager(nil)
	mux := http.NewServeMux()
	mux.HandleFunc("/api/tables/{id}/ws", func(w http.ResponseWriter, r *http.Request) {
		tbl := mgr.Get(testRow())
		c := ws.Upgrade(w, r, uid(r), tbl.Send, tbl.Detach)
		if c != nil {
			tbl.Attach(c)
		}
	})
	return mgr, mux
}

func startSrv(t *testing.T, mux *http.ServeMux) *httptest.Server {
	srv := httptest.NewServer(fakeAuth(mux))
	t.Cleanup(srv.Close)
	return srv
}

func TestEndToEnd(t *testing.T) {
	mgr := table.NewManager(nil)
	row := testRow()

	mux := http.NewServeMux()
	mux.HandleFunc("/api/tables/{id}/ws", func(w http.ResponseWriter, r *http.Request) {
		tbl := mgr.Get(row)
		c := ws.Upgrade(w, r, uid(r), tbl.Send, tbl.Detach)
		if c != nil {
			tbl.Attach(c)
		}
	})
	srv := httptest.NewServer(fakeAuth(mux))
	defer srv.Close()
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/tables/t1/ws"

	a := dial(t, wsURL, "userA")
	defer a.CloseNow()
	b := dial(t, wsURL, "userB")
	defer b.CloseNow()

	sendJSON(t, a, protocol.ClientMsg{Type: "join", Seat: 0})
	sendJSON(t, b, protocol.ClientMsg{Type: "join", Seat: 1})

	// dedicated reader per conn: collect until both have holes (hand
	// auto-starts ~3s after 2 seats fill)
	gotA, gotB := waitHoles(t, a, b)
	if !gotA || !gotB {
		t.Fatal("hand never started within 8s")
	}
}

func waitHoles(t *testing.T, a, b *websocket.Conn) (bool, bool) {
	t.Helper()
	res := make(chan bool, 2)
	reader := func(c *websocket.Conn) {
		got := false
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		for !got {
			_, data, err := c.Read(ctx)
			if err != nil {
				break
			}
			var m protocol.ServerMsg
			if json.Unmarshal(data, &m) == nil && m.Type == "event" && m.Event != nil && m.Event.Type == protocol.EvHolesDealt {
				got = true
				if m.Event.Seat != 1 && c == b {
					t.Errorf("B received holes for seat %d — redaction leak", m.Event.Seat)
				}
			}
		}
		res <- got
	}
	go reader(a)
	go reader(b)
	first := <-res
	second := <-res
	return first, second
}

func sendJSON(t *testing.T, c *websocket.Conn, m protocol.ClientMsg) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	data, _ := json.Marshal(m)
	if err := c.Write(ctx, websocket.MessageText, data); err != nil {
		t.Fatalf("write: %v", err)
	}
}

func testRow() store.GameTable {
	return store.GameTable{
		ID:       "t1",
		Name:     "e2e",
		GameType: "NLHE",
		Config: store.TableConfig{
			BlindsSBBB:      []int64{50, 100},
			StartingStackBB: 100,
			ActionTimeoutS:  30,
			InterHandDelayS: 300,
			MaxSeats:        4,
		},
	}
}
