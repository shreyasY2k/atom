package deploy

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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
func BuildImage(dir, image string) error {
	return BuildImageWithArgs(dir, image, nil)
}

// BuildImageWithArgs runs `docker build` with optional extra args (e.g. --build-arg).
func BuildImageWithArgs(dir, image string, extraArgs []string) error {
	args := append([]string{"build", "-t", image}, extraArgs...)
	args = append(args, dir)
	cmd := exec.Command("docker", args...)
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
