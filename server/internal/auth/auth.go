// Package auth validates Supabase JWTs against the project JWKS and
// exposes HTTP middleware + context helpers.
package auth

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type contextKey int

const userIDKey contextKey = 0

// UserID returns the authenticated user's Supabase `sub` claim, or "" if absent.
func UserID(ctx context.Context) string {
	id, _ := ctx.Value(userIDKey).(string)
	return id
}

// Validator validates Supabase access tokens.
type Validator struct {
	jwksURL   string
	audience  string
	issuer    string
	keys      map[string]*rsa.PublicKey
	mu        sync.RWMutex
	fetchedAt time.Time
	client    *http.Client
}

// New builds a Validator from SUPABASE_URL and SUPABASE_ANON_KEY.
// Tokens are expected to carry issuer SUPABASE_URL/auth/v1 and the anon key as audience.
func New(supabaseURL, anonKey string) (*Validator, error) {
	u, err := url.Parse(strings.TrimRight(supabaseURL, "/"))
	if err != nil {
		return nil, fmt.Errorf("auth: parse SUPABASE_URL: %w", err)
	}
	return &Validator{
		jwksURL:   u.String() + "/auth/v1/.well-known/jwks.json",
		audience:  anonKey,
		issuer:    u.String() + "/auth/v1",
		keys:      map[string]*rsa.PublicKey{},
		client:    &http.Client{Timeout: 10 * time.Second},
	}, nil
}

// key returns the RSA public key for a kid, refreshing the JWKS once on miss.
func (v *Validator) key(kid string) (*rsa.PublicKey, error) {
	v.mu.RLock()
	key, ok := v.keys[kid]
	age := time.Since(v.fetchedAt)
	v.mu.RUnlock()
	if ok && age < 24*time.Hour {
		return key, nil
	}
	if err := v.refresh(); err != nil {
		return nil, err
	}
	v.mu.RLock()
	defer v.mu.RUnlock()
	if key, ok := v.keys[kid]; ok {
		return key, nil
	}
	return nil, fmt.Errorf("auth: kid %q not in JWKS", kid)
}

// refresh fetches the JWKS and replaces cached keys.
func (v *Validator) refresh() error {
	v.mu.Lock()
	defer v.mu.Unlock()
	// Another goroutine may have refreshed while we waited on the lock.
	if time.Since(v.fetchedAt) < time.Minute {
		return nil
	}
	resp, err := v.client.Get(v.jwksURL)
	if err != nil {
		return fmt.Errorf("auth: fetch JWKS: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("auth: fetch JWKS: status %d", resp.StatusCode)
	}
	var jwks struct {
		Keys []struct {
			Kid string `json:"kid"`
			N   string `json:"n"`
			E   string `json:"e"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&jwks); err != nil {
		return fmt.Errorf("auth: decode JWKS: %w", err)
	}
	keys := make(map[string]*rsa.PublicKey, len(jwks.Keys))
	for _, k := range jwks.Keys {
		n, err := decodeBase64URL(k.N)
		if err != nil {
			return fmt.Errorf("auth: JWKS kid %s modulus: %w", k.Kid, err)
		}
		e, err := decodeBase64URL(k.E)
		if err != nil {
			return fmt.Errorf("auth: JWKS kid %s exponent: %w", k.Kid, err)
		}
		exp := 0
		for _, b := range e {
			exp = exp<<8 | int(b)
		}
		keys[k.Kid] = &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: exp}
	}
	if len(keys) == 0 {
		return errors.New("auth: JWKS contains no keys")
	}
	v.keys = keys
	v.fetchedAt = time.Now()
	return nil
}

func decodeBase64URL(s string) ([]byte, error) {
	return base64.RawURLEncoding.DecodeString(s)
}

// Validate parses and validates a Supabase access token, returning the user id (`sub`).
func (v *Validator) Validate(tokenStr string) (string, error) {
	tok, _, err := jwt.NewParser().ParseUnverified(tokenStr, &jwt.RegisteredClaims{})
	if err != nil {
		return "", fmt.Errorf("auth: parse token: %w", err)
	}
	kid, _ := tok.Header["kid"].(string)
	if kid == "" {
		return "", errors.New("auth: token missing kid header")
	}
	key, err := v.key(kid)
	if err != nil {
		return "", err
	}
	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (any, error) {
		return key, nil
	}, jwt.WithValidMethods([]string{"RS256"}),
		jwt.WithAudience(v.audience), jwt.WithIssuer(v.issuer),
		jwt.WithExpirationRequired(), jwt.WithLeeway(60*time.Second))
	if err != nil {
		return "", fmt.Errorf("auth: validate token: %w", err)
	}
	if !token.Valid {
		return "", errors.New("auth: invalid token")
	}
	sub, err := token.Claims.GetSubject()
	if err != nil || sub == "" {
		return "", errors.New("auth: token missing sub claim")
	}
	return sub, nil
}

// Middleware wraps h, requiring a valid Supabase JWT from
// `Authorization: Bearer <token>` or `?token=` (WS handshake).
// Invalid/missing credentials get 401. Requests that fail validation after a
// JWKS refresh are logged; everything here is per-request fail-closed.
func (v *Validator) Middleware(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tokenStr := bearerToken(r)
		if tokenStr == "" {
			http.Error(w, "missing bearer token", http.StatusUnauthorized)
			return
		}
		uid, err := v.Validate(tokenStr)
		if err != nil {
			log.Printf("auth: rejected: %v", err)
			http.Error(w, "invalid token", http.StatusUnauthorized)
			return
		}
		h.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userIDKey, uid)))
	})
}

func bearerToken(r *http.Request) string {
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
	}
	return r.URL.Query().Get("token")
}

func (v *Validator) Close() {}
