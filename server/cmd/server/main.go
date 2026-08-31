// Server: REST table endpoints + authenticated websocket upgrade.
//
// Env: PORT (default 8080), SUPABASE_URL, SUPABASE_ANON_KEY,
// DATABASE_URL (Supabase service connection string).
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/aspectrr/online-poker/server/internal/auth"
	"github.com/aspectrr/online-poker/server/internal/store"
	"github.com/aspectrr/online-poker/server/internal/table"
	"github.com/aspectrr/online-poker/server/internal/ws"
)

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func main() {
	supabaseURL := os.Getenv("SUPABASE_URL")
	anonKey := os.Getenv("SUPABASE_ANON_KEY")
	dbURL := os.Getenv("DATABASE_URL")

	// DEV_AUTH=1: `?token=dev:<email>` bypasses Supabase JWT validation and
	// mints a deterministic fake uid. Off by default; dev only.
	if os.Getenv("DEV_AUTH") == "1" {
		auth.EnableDevAuth()
		log.Printf("DEV AUTH ENABLED — dev:<email> tokens accepted, tables work without a database")
	}

	validator, err := auth.New(supabaseURL, anonKey)
	if err != nil {
		log.Fatalf("auth: %v", err)
	}

	// -healthcheck: container HEALTHCHECK probe — hits the running server's
	// /healthz on localhost and exits 0/1 (distroless has no shell/curl).
	if len(os.Args) > 1 && os.Args[1] == "-healthcheck" {
		resp, err := http.Get("http://127.0.0.1:" + env("PORT", "8080") + "/healthz")
		if err != nil || resp.StatusCode != http.StatusOK {
			os.Exit(1)
		}
		resp.Body.Close()
		os.Exit(0)
	}

	var st *store.Store
	var mgr *table.Manager
	if dbURL != "" {
		st, err = store.New(context.Background(), dbURL)
		if err != nil {
			log.Fatalf("store: %v", err)
		}
		defer st.Close()
	}
	devAuth := os.Getenv("DEV_AUTH") == "1"
	// persist: real store, or in-memory hands in dev no-DB mode so hand
	// history works backendless. nil = none (non-dev without a database).
	var persist table.Persister
	var mem *memHands
	if st != nil {
		persist = st
	} else if devAuth {
		mem = newMemHands()
		persist = mem
	}
	mgr = table.NewManager(persist)
	mgr.DevMode = devAuth

	// Fixed no-DB dev table: RIT always, 7-2 on, bomb pot on queens.
	devRow := func() *store.GameTable {
		return &store.GameTable{
			ID:       "dev-table",
			Name:     "Dev Table",
			GameType: "NLHE",
			Config: store.TableConfig{
				BlindsSBBB:       []int64{10, 20},
				StartingStackBB:  200,
				ActionTimeoutS:   120,
				InterHandDelayS:  5,
				RIT:              "always",
				RabbitHunt:       true,
				BombPotMode:      "trigger",
				BombPotTriggers:  []store.BombPotTrigger{{Rank: intPtr(12)}}, // queens dealt -> next hand bomb pot
				SevenDeuce:       true,
				SevenDeuceBounty: 100,
				MaxSeats:         6,
			},
		}
	}

	// Without a database, DEV_AUTH mode serves in-memory tables so the full
	// create/join/play flow runs backendless. dev-table is always present.
	postTables := func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "creating tables needs a database", http.StatusServiceUnavailable)
	}
	getTables := func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "no database configured", http.StatusServiceUnavailable)
	}
	getTable := func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "not found", http.StatusNotFound)
	}
	// devLookup: dev-mode row lookup for the WS path (set when dev tables on)
	var devLookup func(id string) *store.GameTable
	if devAuth && st == nil {
		var mu sync.Mutex
		created := map[string]store.GameTable{}
		// lookup shared by REST GET and the WS upgrade path
		devRowByID := func(id string) *store.GameTable {
			mu.Lock()
			defer mu.Unlock()
			if id == "dev-table" {
				return devRow()
			}
			if row, ok := created[id]; ok {
				return &row
			}
			return nil
		}
		getTables = func(w http.ResponseWriter, _ *http.Request) {
			mu.Lock()
			defer mu.Unlock()
			rows := []*store.GameTable{devRow()}
			for id := range created {
				row := created[id]
				rows = append(rows, &row)
			}
			writeJSON(w, http.StatusOK, rows)
		}
		getTable = func(w http.ResponseWriter, r *http.Request) {
			row := devRowByID(r.PathValue("id"))
			if row == nil {
				http.Error(w, "not found", http.StatusNotFound)
				return
			}
			writeJSON(w, http.StatusOK, row)
		}
		devLookup = devRowByID
		postTables = func(w http.ResponseWriter, r *http.Request) {
			var req struct {
				Name     string          `json:"name"`
				GameType string          `json:"game_type"`
				Config   json.RawMessage `json:"config"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "bad json", http.StatusBadRequest)
				return
			}
			var cfg store.TableConfig
			if len(req.Config) > 0 {
				if err := json.Unmarshal(req.Config, &cfg); err != nil {
					http.Error(w, "bad config", http.StatusBadRequest)
					return
				}
			}
			cfg.ApplyDefaults()
			if err := cfg.Validate(); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			uid := auth.UserID(r.Context())
			row := store.GameTable{
				ID:       "dev-" + newDevID(),
				Name:     req.Name,
				GameType: req.GameType,
				Config:   cfg,
				CreatedBy: &uid,
			}
			mu.Lock()
			created[row.ID] = row
			mu.Unlock()
			writeJSON(w, http.StatusCreated, row)
		}
	}

	getHands := func(w http.ResponseWriter, r *http.Request) {
		limit := 50
		if v := r.URL.Query().Get("limit"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 200 {
				limit = n
			}
		}
		id := r.PathValue("id")
		var (
			rows []store.Hand
			err  error
		)
		if st != nil {
			rows, err = st.ListHands(r.Context(), id, limit)
		} else if mem != nil {
			if devLookup != nil && devLookup(id) == nil {
				http.Error(w, "not found", http.StatusNotFound)
				return
			}
			rows, err = mem.ListHands(r.Context(), id, limit)
		} else {
			http.Error(w, "hand history needs a database", http.StatusServiceUnavailable)
			return
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if rows == nil {
			rows = []store.Hand{}
		}
		writeJSON(w, http.StatusOK, rows)
	}

	allowedOrigin := env("ALLOWED_ORIGIN", "*")
	// Specific origin also unlocks cross-origin WS upgrades (browsers send
	// Origin on WS handshakes); "*" keeps dev localhost-only defaults.
	wsOrigins := []string(nil)
	if allowedOrigin != "*" {
		wsOrigins = append(wsOrigins, allowedOrigin)
	}

	mux := http.NewServeMux()

	// REST: tables. Writes + detail + history stay authed; the lobby list is
	// public read-only so unauthenticated visitors can browse before signing in.
	handle := func(h http.Handler) http.Handler {
		return validator.Middleware(h)
	}
	public := func(h http.Handler) http.Handler { return h }
	mux.Handle("POST /api/tables", handle(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if st == nil {
			postTables(w, r)
			return
		}
		var req struct {
			Name     string          `json:"name"`
			GameType string          `json:"game_type"`
			Config   json.RawMessage `json:"config"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "bad json", http.StatusBadRequest)
			return
		}
		var cfg store.TableConfig
		if len(req.Config) > 0 {
			if err := json.Unmarshal(req.Config, &cfg); err != nil {
				http.Error(w, "bad config", http.StatusBadRequest)
				return
			}
		}
		uid := auth.UserID(r.Context())
		row, err := st.CreateTable(r.Context(), req.Name, req.GameType, cfg, &uid)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, http.StatusCreated, row)
	})))

	mux.Handle("GET /api/tables", public(handle(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if st == nil {
			if devAuth {
				getTables(w, r)
				return
			}
			http.Error(w, "no database configured", http.StatusServiceUnavailable)
			return
		}
		rows, err := st.ListTables(r.Context())
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}))))

	mux.Handle("GET /api/tables/{id}", handle(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if st == nil {
			if devAuth {
				getTable(w, r)
				return
			}
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		row, err := st.GetTable(r.Context(), r.PathValue("id"))
		if err == store.ErrNotFound {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, row)
	})))

	// REST: hand history (newest first, ?limit=50 default).
	mux.Handle("GET /api/tables/{id}/hands", handle(http.HandlerFunc(getHands)))

	// WS: /api/tables/{id}/ws — auth via ?token= (auth.Middleware reads it).
	mux.Handle("GET /api/tables/{id}/ws", handle(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var row *store.GameTable
		if st == nil {
			if devLookup == nil {
				http.Error(w, "not found", http.StatusNotFound)
				return
			}
			row = devLookup(r.PathValue("id"))
			if row == nil {
				http.Error(w, "not found", http.StatusNotFound)
				return
			}
		} else {
			var err error
			row, err = st.GetTable(r.Context(), r.PathValue("id"))
			if err == store.ErrNotFound {
				http.Error(w, "not found", http.StatusNotFound)
				return
			}
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
		}
		t := mgr.Get(*row)
		c := ws.Upgrade(w, r, auth.UserID(r.Context()), t.Send, t.Detach, wsOrigins...)
		if c != nil {
			t.Attach(c)
		}
	})))

	// Health.
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	addr := env("PORT", "8080")
	srv := &http.Server{
		Addr:              ":" + addr,
		Handler:           logRequests(cors(allowedOrigin, mux)),
		ReadHeaderTimeout: 5 * time.Second,
	}
	log.Printf("server: listening on :%s", addr)
	log.Fatal(srv.ListenAndServe())
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("writeJSON: %v", err)
	}
}

func logRequests(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		h.ServeHTTP(w, r)
		if !strings.HasPrefix(r.URL.Path, "/healthz") {
			log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start))
		}
	})
}

// cors: REST cross-origin for the web frontend. ALLOWED_ORIGIN env sets the
// Access-Control-Allow-Origin value (default "*" for dev; set to the Render
// URL in prod). WebSockets don't need it but REST does.
func cors(allowedOrigin string, h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		h.ServeHTTP(w, r)
	})
}

func intPtr(i int) *int { return &i }

// memHands: in-memory hand history for DEV_AUTH no-DB mode. Satisfies
// table.Persister (InsertHand) + serves the GET /hands route (ListHands).
type memHands struct {
	mu    sync.Mutex
	seq   int64
	tables map[string][]store.Hand // newest last
}

func newMemHands() *memHands { return &memHands{tables: map[string][]store.Hand{}} }

func (h *memHands) InsertHand(_ context.Context, tableID string, handNo int, data json.RawMessage) (*store.Hand, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.seq++
	row := store.Hand{ID: h.seq, TableID: tableID, HandNo: handNo, Data: data, CreatedAt: time.Now()}
	h.tables[tableID] = append(h.tables[tableID], row)
	return &row, nil
}

func (h *memHands) ListHands(_ context.Context, tableID string, limit int) ([]store.Hand, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	all := h.tables[tableID]
	if limit <= 0 || limit > len(all) {
		limit = len(all)
	}
	out := make([]store.Hand, 0, limit)
	for i := len(all) - 1; i >= 0 && len(out) < cap(out); i-- {
		out = append(out, all[i])
	}
	return out, nil
}

// newDevID: short random id for in-memory dev tables.
func newDevID() string {
	b := make([]byte, 6)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}
