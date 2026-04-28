package auth

import (
	"crypto/rand"
	"crypto/rsa"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func generateTestKeyPair(t *testing.T) (*rsa.PrivateKey, *rsa.PublicKey) {
	t.Helper()
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate RSA key: %v", err)
	}
	return priv, &priv.PublicKey
}

func signToken(t *testing.T, priv *rsa.PrivateKey, claims *Claims) string {
	t.Helper()
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	signed, err := token.SignedString(priv)
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return signed
}

func TestParseToken_ValidAgentToken(t *testing.T) {
	priv, pub := generateTestKeyPair(t)
	claims := &Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   "agent-123",
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
			Issuer:    "atom-studio",
		},
		Type:     "agent",
		DomainID: "domain-abc",
		AgentID:  "agent-123",
	}
	raw := signToken(t, priv, claims)

	got, err := parseToken(raw, pub)
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if got.Type != "agent" {
		t.Errorf("expected type=agent, got %q", got.Type)
	}
	if got.DomainID != "domain-abc" {
		t.Errorf("expected domain_id=domain-abc, got %q", got.DomainID)
	}
}

func TestParseToken_ExpiredToken(t *testing.T) {
	priv, pub := generateTestKeyPair(t)
	claims := &Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   "agent-123",
			IssuedAt:  jwt.NewNumericDate(time.Now().Add(-2 * time.Hour)),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(-1 * time.Hour)),
		},
		Type: "agent",
	}
	raw := signToken(t, priv, claims)

	_, err := parseToken(raw, pub)
	if err == nil {
		t.Fatal("expected error for expired token, got nil")
	}
	if !isExpired(err) {
		t.Errorf("expected isExpired=true, got false; err: %v", err)
	}
}

func TestParseToken_WrongKey(t *testing.T) {
	priv, _ := generateTestKeyPair(t)
	_, wrongPub := generateTestKeyPair(t) // different key pair
	claims := &Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   "agent-123",
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
		Type: "agent",
	}
	raw := signToken(t, priv, claims)

	_, err := parseToken(raw, wrongPub)
	if err == nil {
		t.Fatal("expected error for wrong key, got nil")
	}
}

func TestParseToken_NilPublicKey(t *testing.T) {
	priv, _ := generateTestKeyPair(t)
	claims := &Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   "agent-123",
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
		Type: "agent",
	}
	raw := signToken(t, priv, claims)

	_, err := parseToken(raw, nil)
	if err == nil {
		t.Fatal("expected error when no public key, got nil")
	}
}

func TestTokenHash_Deterministic(t *testing.T) {
	raw := "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.test"
	h1 := tokenHash(raw)
	h2 := tokenHash(raw)
	if h1 != h2 {
		t.Errorf("token hash not deterministic: %q vs %q", h1, h2)
	}
	if len(h1) != 64 { // sha256 hex = 64 chars
		t.Errorf("expected 64-char hex hash, got %d", len(h1))
	}
}
