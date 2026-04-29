package cmd

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/manifoldco/promptui"
	"github.com/spf13/cobra"
	"github.com/your-org/atom/atom-cli/internal/auth"
	"github.com/your-org/atom/atom-cli/internal/config"
)

var loginCmd = &cobra.Command{
	Use:   "login",
	Short: "Authenticate with atom-studio",
	RunE:  runLogin,
}

func runLogin(_ *cobra.Command, _ []string) error {
	studioURL, err := (&promptui.Prompt{
		Label:   "atom-studio URL",
		Default: "http://localhost:3001",
	}).Run()
	if err != nil {
		return err
	}
	studioURL = strings.TrimRight(strings.TrimSpace(studioURL), "/")

	email, err := (&promptui.Prompt{Label: "Email"}).Run()
	if err != nil {
		return err
	}

	password, err := (&promptui.Prompt{
		Label: "Password",
		Mask:  '*',
	}).Run()
	if err != nil {
		return err
	}

	fmt.Print("Logging in... ")
	access, refresh, err := auth.Login(studioURL, strings.TrimSpace(email), password)
	if err != nil {
		fmt.Println("✗")
		return err
	}
	fmt.Println("✓")

	atomRoot := detectAtomRoot()

	cfg := &config.Config{
		StudioURL:    studioURL,
		AccessToken:  access,
		RefreshToken: refresh,
		AtomRoot:     atomRoot,
	}
	if err := config.Save(cfg); err != nil {
		return fmt.Errorf("save config: %w", err)
	}

	fmt.Printf("Logged in. Config saved to ~/.atom/config.json\n")
	if atomRoot != "" {
		fmt.Printf("ATOM root detected: %s\n", atomRoot)
	} else {
		fmt.Printf("Tip: set ATOM_ROOT env var to point at the ATOM repo (needed for atom-sdk install)\n")
	}
	return nil
}

// detectAtomRoot walks up from cwd looking for the ATOM monorepo root
// (identified by go.work or the atom-sdk/ directory).
func detectAtomRoot() string {
	// 1. Env override
	if v := os.Getenv("ATOM_ROOT"); v != "" {
		return v
	}
	// 2. Walk up from cwd
	dir, _ := os.Getwd()
	for i := 0; i < 8; i++ {
		if _, err := os.Stat(filepath.Join(dir, "atom-sdk")); err == nil {
			return dir
		}
		if _, err := os.Stat(filepath.Join(dir, "go.work")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return ""
}
