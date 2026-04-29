package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

const filename = ".atom/config.json"

// Config holds the persisted CLI state (login session).
type Config struct {
	StudioURL    string `json:"studio_url"`
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	AtomRoot     string `json:"atom_root"` // path to ATOM monorepo root (contains atom-sdk/)
}

func path() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, filename), nil
}

func Load() (*Config, error) {
	p, err := path()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(p)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("not logged in — run: atom login")
		}
		return nil, err
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("corrupt config: %w", err)
	}
	if cfg.AccessToken == "" {
		return nil, fmt.Errorf("not logged in — run: atom login")
	}
	return &cfg, nil
}

func Save(cfg *Config) error {
	p, err := path()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p, data, 0o600)
}
