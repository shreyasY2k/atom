package ci

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

const credentialsFilename = ".atom/credentials"

// Credentials holds per-host API tokens for CI providers.
type Credentials struct {
	GitLab map[string]GitLabCredential `json:"gitlab"`
}

// GitLabCredential stores a personal access token for one GitLab host.
type GitLabCredential struct {
	Token string `json:"token"`
}

func credPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, credentialsFilename), nil
}

// LoadCredentials reads ~/.atom/credentials, returning an empty struct if the file does not exist.
func LoadCredentials() (*Credentials, error) {
	p, err := credPath()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(p)
	if err != nil {
		if os.IsNotExist(err) {
			return &Credentials{GitLab: map[string]GitLabCredential{}}, nil
		}
		return nil, fmt.Errorf("read credentials: %w", err)
	}
	var c Credentials
	if err := json.Unmarshal(data, &c); err != nil {
		return nil, fmt.Errorf("corrupt credentials file: %w", err)
	}
	if c.GitLab == nil {
		c.GitLab = map[string]GitLabCredential{}
	}
	return &c, nil
}

// SaveCredentials writes credentials to ~/.atom/credentials with mode 0600.
func SaveCredentials(c *Credentials) error {
	p, err := credPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p, data, 0o600)
}

// GetGitLabToken returns the stored PAT for the given GitLab host (e.g. "gitlab.com").
// Returns empty string if not found.
func GetGitLabToken(host string) string {
	c, err := LoadCredentials()
	if err != nil || c == nil {
		return ""
	}
	return c.GitLab[host].Token
}

// SaveGitLabToken persists a PAT for the given GitLab host.
func SaveGitLabToken(host, token string) error {
	c, err := LoadCredentials()
	if err != nil {
		return err
	}
	c.GitLab[host] = GitLabCredential{Token: token}
	return SaveCredentials(c)
}
