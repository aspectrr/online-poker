package auth

import "testing"

func TestDevToken(t *testing.T) {
	EnableDevAuth()
	defer func() { devEnabled = false }()

	uid, ok := devToken("dev:alice@example.com")
	if !ok {
		t.Fatal("dev token rejected while enabled")
	}
	// deterministic + uuid-shaped
	if uid != devUID("alice@example.com") {
		t.Fatalf("uid not deterministic: %s", uid)
	}
	if len(uid) != 36 || uid[8] != '-' || uid[13] != '-' {
		t.Fatalf("uid not uuid-shaped: %s", uid)
	}
	// distinct emails -> distinct uids
	bobUID, ok := devToken("dev:bob@example.com")
	if !ok || bobUID == uid {
		t.Fatal("distinct emails minted the same uid")
	}
	// non-dev tokens fall through
	if _, ok := devToken("eyJhbGciOiJSUzI1NiJ9.x.y"); ok {
		t.Fatal("jwt accepted as dev token")
	}
	// empty email rejected
	if _, ok := devToken("dev:"); ok {
		t.Fatal("empty email accepted")
	}
}

// bypass must be OFF by default.
func TestDevTokenDisabled(t *testing.T) {
	if _, ok := devToken("dev:alice@example.com"); ok {
		t.Fatal("dev token accepted while bypass disabled")
	}
}
