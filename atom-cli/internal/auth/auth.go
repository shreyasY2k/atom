package auth

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

type loginReq struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type loginResp struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
}

// Login authenticates with atom-studio and returns the access + refresh tokens.
func Login(studioURL, email, password string) (accessToken, refreshToken string, err error) {
	body, _ := json.Marshal(loginReq{Email: email, Password: password})
	url := strings.TrimRight(studioURL, "/") + "/api/auth/login"

	resp, err := http.Post(url, "application/json", bytes.NewReader(body)) //nolint:noctx
	if err != nil {
		return "", "", fmt.Errorf("could not reach atom-studio at %s: %w", studioURL, err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("login failed (%d): %s", resp.StatusCode, string(raw))
	}

	var lr loginResp
	if err := json.Unmarshal(raw, &lr); err != nil {
		return "", "", fmt.Errorf("unexpected response: %w", err)
	}
	return lr.AccessToken, lr.RefreshToken, nil
}
