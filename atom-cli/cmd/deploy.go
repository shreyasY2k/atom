package cmd

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/manifoldco/promptui"
	"github.com/spf13/cobra"
	"github.com/your-org/atom/atom-cli/internal/ci"
	"github.com/your-org/atom/atom-cli/internal/config"
	"github.com/your-org/atom/atom-cli/internal/deploy"
)

var deployCmd = &cobra.Command{
	Use:   "deploy",
	Short: "Build and deploy the agent in the current directory",
	Long: `Builds a Docker image and submits a deployment to atom-studio.
An admin must approve the deployment in the HITL queue before
atom-runtime starts the container.

Build modes (--ci flag):
  local   — docker build on this machine (default)
  github  — trigger GitHub Actions workflow (atom-build.yml) to build + push to GHCR
  gitlab  — trigger GitLab CI pipeline (.gitlab-ci.yml) to build + push to GitLab Registry`,
	RunE: runDeploy,
}

var (
	deployAgentID string
	deployImage   string
	deployMessage string
	deploySkip    bool
	deployCIMode  string
	deployRepo    string
	deployCIToken string
	deployBranch  string
)

func init() {
	deployCmd.Flags().StringVar(&deployAgentID, "agent-id", "", "Agent UUID (reads ATOM_AGENT_ID from .env if not set)")
	deployCmd.Flags().StringVar(&deployImage, "image", "", "Docker image name (defaults to project directory name)")
	deployCmd.Flags().StringVar(&deployMessage, "message", "", "Deployment message / changelog")
	deployCmd.Flags().BoolVar(&deploySkip, "skip-build", false, "Skip docker build and use existing image")
	deployCmd.Flags().StringVar(&deployCIMode, "ci", "local", "CI build provider: local | github | gitlab")
	deployCmd.Flags().StringVar(&deployRepo, "repo", "", "Repository URL for CI builds (auto-detected from git remote)")
	deployCmd.Flags().StringVar(&deployCIToken, "token", "", "CI API token (reads GITHUB_TOKEN or GITLAB_TOKEN from env)")
	deployCmd.Flags().StringVar(&deployBranch, "branch", "main", "Branch to build from (CI mode only)")
}

func runDeploy(_ *cobra.Command, _ []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	// Validate CI mode
	switch deployCIMode {
	case "local", "github", "gitlab":
	default:
		return fmt.Errorf("unknown --ci value %q; choose local, github, or gitlab", deployCIMode)
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

	var image string

	switch deployCIMode {
	case "local":
		image, err = runLocalBuild()
		if err != nil {
			return err
		}

	case "github":
		image, err = runGitHubBuild()
		if err != nil {
			return err
		}

	case "gitlab":
		image, err = runGitLabBuild()
		if err != nil {
			return err
		}
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

func runLocalBuild() (string, error) {
	if deploySkip {
		image := deployImage
		if image == "" {
			dir, _ := os.Getwd()
			image = filepath.Base(dir) + ":latest"
		}
		return image, nil
	}
	image := deployImage
	if image == "" {
		dir, _ := os.Getwd()
		image = filepath.Base(dir) + ":latest"
	}
	fmt.Printf("Building image %s locally ...\n", image)
	if err := deploy.BuildImage(".", image); err != nil {
		return "", err
	}
	fmt.Printf("✓ Image built: %s\n\n", image)
	return image, nil
}

func runGitHubBuild() (string, error) {
	repoURL, err := resolveRepoURL(deployRepo, "github.com")
	if err != nil {
		return "", err
	}
	token := deployCIToken
	if token == "" {
		token = os.Getenv("GITHUB_TOKEN")
	}
	if token == "" {
		return "", fmt.Errorf("GitHub token required: set GITHUB_TOKEN or pass --token")
	}

	imageTag := "latest"
	gh := &ci.GitHub{Token: token}

	fmt.Printf("→ Triggering GitHub Actions build on %s (branch: %s) ...\n", repoURL, deployBranch)
	actionsURL, imageRef, err := gh.TriggerBuild(repoURL, deployBranch, imageTag)
	if err != nil {
		return "", fmt.Errorf("trigger GitHub build: %w", err)
	}
	fmt.Printf("  Actions: %s\n", actionsURL)
	fmt.Printf("  Image:   %s (will be available after build)\n", imageRef)
	fmt.Printf("→ Waiting for workflow to complete (up to 30 min) ...\n")

	if err := gh.WaitForBuild(repoURL, deployBranch, 30*time.Minute); err != nil {
		return "", fmt.Errorf("GitHub build failed: %w", err)
	}
	fmt.Printf("✓ GitHub Actions build complete\n\n")
	return imageRef, nil
}

func runGitLabBuild() (string, error) {
	repoURL, err := resolveRepoURL(deployRepo, "gitlab.com")
	if err != nil {
		return "", err
	}
	token := deployCIToken
	if token == "" {
		token = os.Getenv("GITLAB_TOKEN")
	}
	if token == "" {
		return "", fmt.Errorf("GitLab token required: set GITLAB_TOKEN or pass --token")
	}

	imageTag := "latest"
	gl := &ci.GitLab{Token: token}

	fmt.Printf("→ Triggering GitLab CI pipeline on %s (branch: %s) ...\n", repoURL, deployBranch)
	pipelineID, imageRef, err := gl.TriggerBuild(repoURL, deployBranch, imageTag)
	if err != nil {
		return "", fmt.Errorf("trigger GitLab pipeline: %w", err)
	}
	fmt.Printf("  Pipeline ID: %d\n", pipelineID)
	fmt.Printf("  Image:       %s (will be available after build)\n", imageRef)
	fmt.Printf("→ Waiting for pipeline to complete (up to 30 min) ...\n")

	if err := gl.WaitForBuild(repoURL, pipelineID, 30*time.Minute); err != nil {
		return "", fmt.Errorf("GitLab build failed: %w", err)
	}
	fmt.Printf("✓ GitLab CI build complete\n\n")
	return imageRef, nil
}

// resolveRepoURL returns --repo if set, otherwise reads the git remote URL
// and validates it matches the expected host (github.com or gitlab.com).
func resolveRepoURL(flagValue, expectedHost string) (string, error) {
	if flagValue != "" {
		return flagValue, nil
	}
	out, err := exec.Command("git", "remote", "get-url", "origin").Output()
	if err != nil {
		return "", fmt.Errorf("could not detect repo URL from git remote; pass --repo explicitly")
	}
	remote := strings.TrimSpace(string(out))
	// Normalise SSH → HTTPS
	if strings.HasPrefix(remote, "git@") {
		remote = strings.Replace(remote, ":", "/", 1)
		remote = strings.Replace(remote, "git@", "https://", 1)
	}
	if !strings.Contains(remote, expectedHost) {
		return "", fmt.Errorf("git remote %q is not a %s URL; pass --repo explicitly", remote, expectedHost)
	}
	return remote, nil
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
