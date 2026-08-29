// Server: REST table endpoints + authenticated websocket upgrade.
//
// Env: PORT (default 8080), SUPABASE_URL, SUPABASE_ANON_KEY,
// DATABASE_URL (Supabase service connection string).
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
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

	var st *store.Store
	var mgr *table.Manager
	if dbURL != "" {
		st, err = store.New(nil, dbURL)
		if err != nil {
			log.Fatalf("store: %v", err)
		}
		defer st.Close()
	}
	mgr = table.NewManager(st) // nil store = no persistence (dev)

	devAuth := os.Getenv("DEV_AUTH") == "1"
	// Without a database, DEV_AUTH mode serves one fixed in-memory table so
	// the full join/play flow runs backendless.
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
				BombPotTriggers:  []store.BombPotTrigger{{Rank: intPtr(12)}}, // aces dealt -> next hand bomb pot
				SevenDeuce:       true,
				SevenDeuceBounty: 100,
				MaxSeats:         6,
			},
		}
	}

	mux := http.NewServeMux()

	// REST: tables.
	handle := func(h http.Handler) http.Handler {
		return validator.Middleware(h)
	}
	mux.Handle("POST /api/tables", handle(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if st == nil {
			http.Error(w, "creating tables needs a database", http.StatusServiceUnavailable)
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

	mux.Handle("GET /api/tables", handle(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if st == nil {
			if devAuth {
				writeJSON(w, http.StatusOK, []*store.GameTable{devRow()})
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
	})))

	mux.Handle("GET /api/tables/{id}", handle(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if st == nil {
			if devAuth && r.PathValue("id") == devRow().ID {
				writeJSON(w, http.StatusOK, devRow())
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

	// WS: /api/tables/{id}/ws — auth via ?token= (auth.Middleware reads it).
	mux.Handle("GET /api/tables/{id}/ws", handle(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var row *store.GameTable
		if st == nil {
			if devAuth && r.PathValue("id") == devRow().ID {
				row = devRow()
			} else {
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
		c := ws.Upgrade(w, r, auth.UserID(r.Context()), t.Send, t.Detach)
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
		Handler:           logRequests(cors(mux)),
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

// cors: permissive dev CORS (the vite dev server is a different origin);
// auth stays token-gated. WebSockets don't need it but REST does.
func cors(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
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
