package cmd

import (
	"fmt"
	"strings"

	"github.com/manifoldco/promptui"
	"github.com/spf13/cobra"
	"github.com/your-org/atom/atom-cli/internal/auth"
	"github.com/your-org/atom/atom-cli/internal/config"
)

var loginCmd = &cobra.Command{
	Use:   "login",
	Short: "Authenticate with atom-studio",
	Long: `Prompts for atom-studio URL, email, and password, then saves the
session token to ~/.atom/config.json.

Default URL:  http://localhost:3001  (docker-compose)
              http://api.atom.local  (Kubernetes / ingress)
Credentials:  admin@atom.local / admin123  (development seed)`,
	RunE: runLogin,
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

	cfg := &config.Config{
		StudioURL:    studioURL,
		AccessToken:  access,
		RefreshToken: refresh,
	}
	if err := config.Save(cfg); err != nil {
		return fmt.Errorf("save config: %w", err)
	}

	fmt.Printf("Logged in. Config saved to ~/.atom/config.json\n")
	return nil
}
