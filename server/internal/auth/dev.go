package auth

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

// DEV_AUTH=1 only: `dev:<email>` tokens mint a deterministic fake uid
// (sha256 of the email, uuid-shaped) so two browser tabs = two players
// without Supabase. Never enable in production.
const devPrefix = "dev:"

// DevEnabled reports whether the bypass is active.
func DevEnabled() bool { return devEnabled }

var devEnabled bool

// EnableDevAuth turns on the dev-token bypass (called from main when
// DEV_AUTH=1).
func EnableDevAuth() { devEnabled = true }

// devUID: deterministic uuid-shaped id from the email.
func devUID(email string) string {
	sum := sha256.Sum256([]byte("aspectrr-dev:" + email))
	h := hex.EncodeToString(sum[:16])
	return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:32]
}

// devToken checks a token against the bypass; ok=false when the bypass is
// off or the token isn't a dev token.
func devToken(tokenStr string) (uid string, ok bool) {
	if !devEnabled || !strings.HasPrefix(tokenStr, devPrefix) {
		return "", false
	}
	email := strings.TrimSpace(strings.TrimPrefix(tokenStr, devPrefix))
	if email == "" || len(email) > 200 {
		return "", false
	}
	return devUID(email), true
}
