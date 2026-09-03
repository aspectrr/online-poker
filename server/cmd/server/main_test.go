package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
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

// ipGate: per-IP fixed window — limit allows exactly `limit`, then blocks
// until the window passes.
func TestIPGateWindow(t *testing.T) {
	g := newIPGate(3, time.Hour)
	for range 3 {
		if !g.allow("1.2.3.4") {
			t.Fatal("mint within limit rejected")
		}
	}
	if g.allow("1.2.3.4") {
		t.Fatal("mint over limit allowed")
	}
	if !g.allow("5.6.7.8") {
		t.Fatal("other IP blocked by 1.2.3.4's window")
	}
}

func TestIPGateWindowReset(t *testing.T) {
	g := newIPGate(1, 10*time.Millisecond)
	if !g.allow("1.2.3.4") || g.allow("1.2.3.4") {
		t.Fatal("first window wrong")
	}
	time.Sleep(15 * time.Millisecond)
	if !g.allow("1.2.3.4") {
		t.Fatal("window did not reset")
	}
}

func TestClientIPFallsBackToRemoteAddr(t *testing.T) {
	r := httptest.NewRequest("POST", "/api/auth/guest", nil)
	if got := clientIP(r); got != "192.0.2.1" {
		t.Fatalf("clientIP = %q, want 192.0.2.1", got)
	}
	r.Header.Set("Fly-Client-IP", "203.0.113.9")
	if got := clientIP(r); got != "203.0.113.9" {
		t.Fatalf("clientIP = %q, want 203.0.113.9", got)
	}
}
