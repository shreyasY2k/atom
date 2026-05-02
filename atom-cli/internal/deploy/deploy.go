package deploy

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strings"
)

// deployReq matches DeploymentSubmitPayload — agent_id is a path param, not body.
type deployReq struct {
	Image   string `json:"image"`
	Message string `json:"message,omitempty"`
}

type deployResp struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

// BuildImage runs `docker build -t image .` in the given directory.
// Automatically injects a GitHub token as a build-arg so pip can clone
// from private repos. Token resolution order:
//  1. GITHUB_TOKEN env var (explicit)
//  2. git credential store (macOS Keychain, Windows Credential Manager, etc.)
func BuildImage(dir, image string) error {
	args := []string{"build", "-t", image, dir}
	if token := resolveGitHubToken(); token != "" {
		args = append(args, "--build-arg", "GITHUB_TOKEN="+token)
		fmt.Println("  [docker] GitHub credentials found — passing token as build-arg")
	}
	cmd := exec.Command("docker", args...)
	cmd.Stdout = newPrefixWriter("  [docker] ")
	cmd.Stderr = newPrefixWriter("  [docker] ")
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("docker build failed: %w", err)
	}
	return nil
}

// resolveGitHubToken returns a GitHub token from the environment or the
// system git credential store (macOS Keychain, Windows Credential Manager, etc.).
func resolveGitHubToken() string {
	if t := os.Getenv("GITHUB_TOKEN"); t != "" {
		return t
	}
	// Ask git's credential helper for github.com credentials.
	cmd := exec.Command("git", "credential", "fill")
	cmd.Stdin = strings.NewReader("protocol=https\nhost=github.com\n\n")
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(out), "\n") {
		if strings.HasPrefix(line, "password=") {
			return strings.TrimPrefix(line, "password=")
		}
	}
	return ""
}

// Submit calls POST /api/deployments/{agent_id} on atom-studio.
func Submit(studioURL, token, agentID, image, message string) (*deployResp, error) {
	body, _ := json.Marshal(deployReq{Image: image, Message: message})
	url := strings.TrimRight(studioURL, "/") + "/api/deployments/" + agentID

	req, _ := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("API error (%d): %s", resp.StatusCode, string(raw))
	}

	var dr deployResp
	_ = json.Unmarshal(raw, &dr)
	return &dr, nil
}

type prefixWriter struct{ prefix string }

func newPrefixWriter(prefix string) *prefixWriter { return &prefixWriter{prefix: prefix} }

func (w *prefixWriter) Write(p []byte) (int, error) {
	lines := strings.Split(strings.TrimRight(string(p), "\n"), "\n")
	for _, l := range lines {
		if l != "" {
			fmt.Println(w.prefix + l)
		}
	}
	return len(p), nil
}
