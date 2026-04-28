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
