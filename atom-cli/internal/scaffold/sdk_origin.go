package scaffold

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// ResolveSDKImage returns the container registry path for the atom-sdk base image.
// It tries two sources in order:
//  1. atom-sdk/.registry file (used when atom-sdk is a directory inside the monorepo)
//  2. git remote gl_origin of the atom-sdk subdirectory (used when atom-sdk is a separate repo)
//
// Returns empty string (no error) if neither source is configured.
func ResolveSDKImage(atomRoot string) (string, error) {
	sdkDir := filepath.Join(atomRoot, "atom-sdk")

	// 1. Check for .registry file (monorepo layout)
	if data, err := os.ReadFile(filepath.Join(sdkDir, ".registry")); err == nil {
		if v := strings.TrimSpace(string(data)); v != "" {
			return v, nil
		}
	}

	// 2. Try gl_origin remote (separate-repo layout)
	out, err := exec.Command("git", "-C", sdkDir, "remote", "get-url", "gl_origin").Output()
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
