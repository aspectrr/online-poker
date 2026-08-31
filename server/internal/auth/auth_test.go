package auth

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// fixture: local RSA key + mock JWKS server + token mint.
type fixture struct {
	key    *rsa.PrivateKey
	jwks   *httptest.Server
	claims jwt.RegisteredClaims
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	pub := key.Public().(*rsa.PublicKey)
	jwksServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/auth/v1/.well-known/jwks.json" {
			http.NotFound(w, r)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{
			"keys": []map[string]string{{
				"kid": "test-key",
				"kty": "RSA",
				"use": "sig",
				"alg": "RS256",
				"n":   base64.RawURLEncoding.EncodeToString(pub.N.Bytes()),
				"e":   base64.RawURLEncoding.EncodeToString(big.NewInt(int64(pub.E)).Bytes()),
			}},
		})
	}))
	t.Cleanup(jwksServer.Close)
	return &fixture{
		key:  key,
		jwks: jwksServer,
		claims: jwt.RegisteredClaims{
			Issuer:    jwksServer.URL + "/auth/v1",
			Audience:  jwt.ClaimStrings{"test-anon-key"},
			Subject:   "11111111-1111-1111-1111-111111111111",
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	}
}

func (f *fixture) validator(t *testing.T) *Validator {
	v, err := New(f.jwks.URL, "test-anon-key")
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func (f *fixture) token(mod func(*jwt.RegisteredClaims)) string {
	claims := f.claims
	if mod != nil {
		mod(&claims)
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	tok.Header["kid"] = "test-key"
	s, err := tok.SignedString(f.key)
	if err != nil {
		panic(err)
	}
	return s
}

func TestValidate_AcceptsGoodToken(t *testing.T) {
	f := newFixture(t)
	uid, err := f.validator(t).Validate(f.token(nil))
	if err != nil {
		t.Fatal(err)
	}
	if uid != "11111111-1111-1111-1111-111111111111" {
		t.Fatalf("uid = %q", uid)
	}
}

func TestValidate_AcceptsES256SigningKey(t *testing.T) {
	// Supabase JWT signing keys: EC P-256 key in JWKS, aud "authenticated".
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	jwksServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"keys": []map[string]string{{
				"kid": "ec-key",
				"kty": "EC",
				"crv": "P-256",
				"use": "sig",
				"alg": "ES256",
				"x":   base64.RawURLEncoding.EncodeToString(key.X.Bytes()),
				"y":   base64.RawURLEncoding.EncodeToString(key.Y.Bytes()),
			}},
		})
	}))
	defer jwksServer.Close()

	v, err := New(jwksServer.URL, "test-anon-key")
	if err != nil {
		t.Fatal(err)
	}
	claims := jwt.RegisteredClaims{
		Issuer:    jwksServer.URL + "/auth/v1",
		Audience:  jwt.ClaimStrings{"authenticated"},
		Subject:   "22222222-2222-2222-2222-222222222222",
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodES256, claims)
	tok.Header["kid"] = "ec-key"
	signed, err := tok.SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	uid, err := v.Validate(signed)
	if err != nil {
		t.Fatal(err)
	}
	if uid != claims.Subject {
		t.Fatalf("uid = %q", uid)
	}
}

func TestValidate_RejectsBadSignature(t *testing.T) {
	f := newFixture(t)
	// sign with a different key, same kid
	other, _ := rsa.GenerateKey(rand.Reader, 2048)
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, f.claims)
	tok.Header["kid"] = "test-key"
	forged, _ := tok.SignedString(other)
	if _, err := f.validator(t).Validate(forged); err == nil {
		t.Fatal("forged token accepted")
	}
}

func TestValidate_RejectsWrongAudience(t *testing.T) {
	f := newFixture(t)
	tok := f.token(func(c *jwt.RegisteredClaims) { c.Audience = jwt.ClaimStrings{"other-aud"} })
	if _, err := f.validator(t).Validate(tok); err == nil {
		t.Fatal("wrong audience accepted")
	}
}

func TestValidate_RejectsWrongIssuer(t *testing.T) {
	f := newFixture(t)
	tok := f.token(func(c *jwt.RegisteredClaims) { c.Issuer = "https://evil.example/auth/v1" })
	if _, err := f.validator(t).Validate(tok); err == nil {
		t.Fatal("wrong issuer accepted")
	}
}

func TestValidate_RejectsExpired(t *testing.T) {
	f := newFixture(t)
	tok := f.token(func(c *jwt.RegisteredClaims) {
		c.ExpiresAt = jwt.NewNumericDate(time.Now().Add(-2 * time.Hour))
	})
	if _, err := f.validator(t).Validate(tok); err == nil {
		t.Fatal("expired token accepted")
	}
}

func TestMiddleware_BearerAndQueryToken(t *testing.T) {
	f := newFixture(t)
	h := f.validator(t).Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if UserID(r.Context()) == "" {
			t.Error("UserID empty in handler")
		}
		w.WriteHeader(200)
	}))

	// Authorization header
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("Authorization", "Bearer "+f.token(nil))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatalf("bearer: code %d", w.Code)
	}

	// ?token= query param (WS handshake path)
	r = httptest.NewRequest("GET", "/?token="+f.token(nil), nil)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatalf("query: code %d", w.Code)
	}
}

func TestMiddleware_RejectsMissing(t *testing.T) {
	f := newFixture(t)
	h := f.validator(t).Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	r := httptest.NewRequest("GET", "/", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 401 {
		t.Fatalf("missing token: code %d", w.Code)
	}
}

func TestUserID_EmptyOutsideMiddleware(t *testing.T) {
	if UserID(context.Background()) != "" {
		t.Fatal("UserID should be empty without middleware")
	}
}

func TestNew_SupabaseURLParsing(t *testing.T) {
	v, err := New("https://abc.supabase.co/", "anon")
	if err != nil {
		t.Fatal(err)
	}
	want := "https://abc.supabase.co/auth/v1/.well-known/jwks.json"
	if v.jwksURL != want {
		t.Fatalf("jwksURL = %q", v.jwksURL)
	}
	if !strings.HasPrefix(v.issuer, "https://abc.supabase.co") {
		t.Fatalf("issuer = %q", v.issuer)
	}
}
