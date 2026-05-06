package scaffold

import (
	"os"
	"path/filepath"
	"strings"
)

// ResolveSDKImage returns the container registry path for the atom-sdk base image
// by reading the atom-sdk/.registry file inside the monorepo root.
// Returns empty string (no error) if the file is absent.
func ResolveSDKImage(atomRoot string) (string, error) {
	sdkDir := filepath.Join(atomRoot, "atom-sdk")
	if data, err := os.ReadFile(filepath.Join(sdkDir, ".registry")); err == nil {
		if v := strings.TrimSpace(string(data)); v != "" {
			return v, nil
		}
	}
	return "", nil
}
