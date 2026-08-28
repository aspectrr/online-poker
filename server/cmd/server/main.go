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

	mux := http.NewServeMux()

	// REST: tables.
	handle := func(h http.Handler) http.Handler {
		return validator.Middleware(h)
	}
	mux.Handle("POST /api/tables", handle(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
		rows, err := st.ListTables(r.Context())
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	})))

	mux.Handle("GET /api/tables/{id}", handle(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
		if st == nil {
			http.Error(w, "no database configured", http.StatusServiceUnavailable)
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
		Handler:           logRequests(mux),
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
