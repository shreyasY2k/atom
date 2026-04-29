package deploy

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
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

// CopyAtomSDK copies the atom-sdk source into .atom-sdk/ in the current directory
// so the Dockerfile can install it with `pip install .atom-sdk/`.
// atomRoot is the ATOM monorepo root (stored in ~/.atom/config.json).
func CopyAtomSDK(atomRoot string) error {
	if atomRoot == "" {
		atomRoot = os.Getenv("ATOM_ROOT")
	}
	if atomRoot == "" {
		return fmt.Errorf("ATOM_ROOT not set and not detected; run: atom login from inside the ATOM repo")
	}

	src := filepath.Join(atomRoot, "atom-sdk")
	if _, err := os.Stat(src); err != nil {
		return fmt.Errorf("atom-sdk not found at %s", src)
	}

	dst := ".atom-sdk"
	_ = os.RemoveAll(dst)

	cmd := exec.Command("cp", "-r", src, dst)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("cp failed: %s", string(out))
	}
	fmt.Printf("  [sdk] copied atom-sdk → %s\n", dst)
	return nil
}

// BuildImage runs `docker build -t image .` in the given directory.
func BuildImage(dir, image string) error {
	cmd := exec.Command("docker", "build", "-t", image, dir)
	cmd.Stdout = newPrefixWriter("  [docker] ")
	cmd.Stderr = newPrefixWriter("  [docker] ")
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("docker build failed: %w", err)
	}
	return nil
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
