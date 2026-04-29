package cmd

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/manifoldco/promptui"
	"github.com/spf13/cobra"
	"github.com/your-org/atom/atom-cli/internal/config"
	"github.com/your-org/atom/atom-cli/internal/deploy"
)

var deployCmd = &cobra.Command{
	Use:   "deploy",
	Short: "Build and deploy the agent in the current directory",
	Long: `Builds a Docker image from the current directory and submits a deployment
to atom-studio. An admin must approve the deployment in the HITL queue before
atom-runtime starts the container.`,
	RunE: runDeploy,
}

var (
	deployAgentID string
	deployImage   string
	deployMessage string
	deploySkip    bool
)

func init() {
	deployCmd.Flags().StringVar(&deployAgentID, "agent-id", "", "Agent UUID (reads ATOM_AGENT_ID from .env if not set)")
	deployCmd.Flags().StringVar(&deployImage, "image", "", "Docker image name (defaults to project directory name)")
	deployCmd.Flags().StringVar(&deployMessage, "message", "", "Deployment message / changelog")
	deployCmd.Flags().BoolVar(&deploySkip, "skip-build", false, "Skip docker build and use existing image")
}

func runDeploy(_ *cobra.Command, _ []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	// Resolve agent ID
	agentID := deployAgentID
	if agentID == "" {
		agentID = envFromDotfile("ATOM_AGENT_ID")
	}
	if agentID == "" {
		agentID, err = (&promptui.Prompt{
			Label: "Agent ID (from atom-studio)",
			Validate: func(s string) error {
				if strings.TrimSpace(s) == "" {
					return fmt.Errorf("required")
				}
				return nil
			},
		}).Run()
		if err != nil {
			return err
		}
		agentID = strings.TrimSpace(agentID)
	}

	// Resolve image name
	image := deployImage
	if image == "" {
		dir, _ := os.Getwd()
		image = filepath.Base(dir) + ":latest"
	}

	// Resolve message
	message := deployMessage
	if message == "" {
		message, err = (&promptui.Prompt{
			Label:   "Deployment message",
			Default: "deploy",
		}).Run()
		if err != nil {
			return err
		}
	}

	// Copy atom-sdk into .atom-sdk/ so Dockerfile can install it locally.
	if !deploySkip {
		if err := deploy.CopyAtomSDK(cfg.AtomRoot); err != nil {
			fmt.Printf("Warning: could not copy atom-sdk (%s) — set ATOM_ROOT or re-run atom login\n", err)
		}
	}

	// Build
	if !deploySkip {
		fmt.Printf("Building image %s ...\n", image)
		if err := deploy.BuildImage(".", image); err != nil {
			return err
		}
		fmt.Printf("✓ Image built: %s\n\n", image)
	}

	// Submit
	fmt.Printf("Submitting deployment to %s ...\n", cfg.StudioURL)
	resp, err := deploy.Submit(cfg.StudioURL, cfg.AccessToken, agentID, image, message)
	if err != nil {
		return err
	}

	fmt.Printf("✓ Deployment submitted\n")
	if resp.ID != "" {
		fmt.Printf("  ID:     %s\n", resp.ID)
	}
	fmt.Printf("  Image:  %s\n", image)
	fmt.Printf("  Status: pending HITL approval\n\n")
	fmt.Printf("Next: approve at %s/hitl\n", strings.Replace(cfg.StudioURL, ":3001", ":3000", 1))
	return nil
}

// envFromDotfile reads a KEY=VALUE entry from .env in the current directory.
func envFromDotfile(key string) string {
	data, err := os.ReadFile(".env")
	if err != nil {
		return ""
	}
	prefix := key + "="
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, prefix) {
			return strings.TrimSpace(strings.TrimPrefix(line, prefix))
		}
	}
	return ""
}
