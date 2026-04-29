package config

import (
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"os"
	"strings"
)

// Config holds all runtime configuration loaded from environment variables.
type Config struct {
	DatabaseURL        string
	RedisURL           string
	JWTPublicKeyPath   string
	JWTPublicKey       *rsa.PublicKey
	PlatformHMACSecret string
	OPABundlePath      string
	OTELEndpoint       string
	GatePort           string
	KafkaBrokers       []string
	// Upstream service URLs
	AtomLLMURL    string // ATOM_LLM_URL
	AtomStudioURL string // ATOM_STUDIO_API_URL
	AtomMemoryURL string // ATOM_MEMORY_URL
	// AtomLLMKey is sent as Authorization: Bearer <key> when GATE forwards
	// LLM calls to atom-llm. The agent JWT is consumed by GATE; atom-llm
	// authenticates via its own LiteLLM master key.
	AtomLLMKey string // ATOM_LLM_KEY (= LITELLM_MASTER_KEY in atom-llm)

	// AtomEncryptionKey is the hex-encoded AES-256 key used by atom-studio to
	// encrypt litellm_virtual_key at rest. GATE uses it to decrypt before forwarding.
	AtomEncryptionKey string // ATOM_ENCRYPTION_KEY
}

func Load() (*Config, error) {
	cfg := &Config{
		DatabaseURL:        env("DATABASE_URL", ""),
		RedisURL:           env("REDIS_URL", "redis://localhost:6379"),
		JWTPublicKeyPath:   env("JWT_PUBLIC_KEY_PATH", ""),
		PlatformHMACSecret: env("PLATFORM_HMAC_SECRET", ""),
		OPABundlePath:      env("OPA_BUNDLE_PATH", "./policies"),
		OTELEndpoint:       env("OTEL_EXPORTER_OTLP_ENDPOINT", ""),
		GatePort:           env("GATE_PORT", "8080"),
		AtomLLMURL:         env("ATOM_LLM_URL", "http://atom-llm:4000"),
		AtomStudioURL:      env("ATOM_STUDIO_API_URL", "http://atom-studio-api:3001"),
		AtomMemoryURL:      env("ATOM_MEMORY_URL", "http://atom-memory:8000"),
		AtomLLMKey:         env("ATOM_LLM_KEY", ""),
		AtomEncryptionKey:  env("ATOM_ENCRYPTION_KEY", ""),
	}

	if brokers := env("KAFKA_BROKERS", ""); brokers != "" {
		cfg.KafkaBrokers = strings.Split(brokers, ",")
	}

	if cfg.JWTPublicKeyPath != "" {
		key, err := loadRSAPublicKey(cfg.JWTPublicKeyPath)
		if err != nil {
			return nil, fmt.Errorf("load JWT public key: %w", err)
		}
		cfg.JWTPublicKey = key
	}

	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	if cfg.PlatformHMACSecret == "" {
		return nil, fmt.Errorf("PLATFORM_HMAC_SECRET is required")
	}

	return cfg, nil
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func loadRSAPublicKey(path string) (*rsa.PublicKey, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read key file %q: %w", path, err)
	}
	block, _ := pem.Decode(data)
	if block == nil {
		return nil, fmt.Errorf("no PEM block found in %q", path)
	}
	pub, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse PKIX public key: %w", err)
	}
	rsaKey, ok := pub.(*rsa.PublicKey)
	if !ok {
		return nil, fmt.Errorf("key in %q is not RSA", path)
	}
	return rsaKey, nil
}
