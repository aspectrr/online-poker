package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCORSSetsConfiguredOrigin(t *testing.T) {
	for _, origin := range []string{"*", "https://online-poker-web.onrender.com"} {
		h := cors(origin, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/tables", nil))
		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != origin {
			t.Errorf("origin %q: header = %q", origin, got)
		}
	}
}

func TestCORSPreflight(t *testing.T) {
	h := cors("*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("preflight must not reach inner handler")
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("OPTIONS", "/api/tables", nil))
	if rec.Code != http.StatusNoContent {
		t.Errorf("preflight status = %d, want 204", rec.Code)
	}
}
