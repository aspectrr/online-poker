package auth

import (
	"encoding/hex"
	"strings"

	rand "crypto/rand"
)

// Guest identity: `guest:<32 hex chars>` tokens minted by POST /api/auth/guest.
// The 128-bit random id is unguessable, so possession of the token IS the
// identity — no signature needed. It grants table join/play and read access;
// table creation still requires a Supabase account.
const guestPrefix = "guest:"

// guestToken validates the shape of a guest token and returns its uid.
func guestToken(tokenStr string) (uid string, ok bool) {
	rest, hasPrefix := strings.CutPrefix(tokenStr, guestPrefix)
	if !hasPrefix || len(rest) != 32 {
		return "", false
	}
	if _, err := hex.DecodeString(rest); err != nil {
		return "", false
	}
	return guestPrefix + rest, true
}

// NewGuestToken mints a fresh guest token.
func NewGuestToken() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic("auth: crypto/rand unavailable: " + err.Error())
	}
	return guestPrefix + hex.EncodeToString(b)
}
