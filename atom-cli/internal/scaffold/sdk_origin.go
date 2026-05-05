package scaffold

import (
	"os/exec"
	"path/filepath"
	"strings"
)

// ResolveSDKImage reads the gl_origin remote from the atom-sdk subdirectory of atomRoot
// and converts it to a container registry URL. Returns empty string (not an error) if
// atom-sdk/gl_origin is not configured — the caller should fall back gracefully.
func ResolveSDKImage(atomRoot string) (string, error) {
	out, err := exec.Command("git", "-C",
		filepath.Join(atomRoot, "atom-sdk"),
		"remote", "get-url", "gl_origin",
	).Output()
	if err != nil {
		return "", nil
	}
	return GitURLToRegistry(strings.TrimSpace(string(out))), nil
}

// GitURLToRegistry converts a GitLab git remote URL to a container registry URL.
//
//	https://gitlab.com/org/atom-sdk.git  →  registry.gitlab.com/org/atom-sdk
//	git@gitlab.com:org/atom-sdk.git      →  registry.gitlab.com/org/atom-sdk
func GitURLToRegistry(gitURL string) string {
	u := strings.TrimSuffix(gitURL, ".git")
	if strings.HasPrefix(u, "git@") {
		u = strings.TrimPrefix(u, "git@")
		u = strings.Replace(u, ":", "/", 1)
	} else {
		u = strings.TrimPrefix(u, "https://")
		u = strings.TrimPrefix(u, "http://")
	}
	return strings.Replace(u, "gitlab.com/", "registry.gitlab.com/", 1)
}
