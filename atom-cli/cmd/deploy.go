package cmd

import (
	"fmt"
	"net/url"
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

Build modes (atom_agent.yaml ci.provider or --ci flag):
  local   — docker build on this machine (default)
  gitlab  — trigger GitLab CI pipeline (.gitlab-ci.yml) to build + push to GitLab Registry
  github  — not yet supported`,
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
	deployCmd.Flags().StringVar(&deployAgentID, "agent-id", "", "Agent UUID (reads from atom_agent.yaml or ATOM_AGENT_ID env)")
	deployCmd.Flags().StringVar(&deployImage, "image", "", "Docker image name (defaults to project directory name)")
	deployCmd.Flags().StringVar(&deployMessage, "message", "", "Deployment message / changelog")
	deployCmd.Flags().BoolVar(&deploySkip, "skip-build", false, "Skip docker build and use existing image")
	deployCmd.Flags().StringVar(&deployCIMode, "ci", "", "CI build provider: local | gitlab (overrides atom_agent.yaml)")
	deployCmd.Flags().StringVar(&deployRepo, "repo", "", "Repository URL for CI builds (auto-detected from git remote)")
	deployCmd.Flags().StringVar(&deployCIToken, "token", "", "GitLab PAT (reads from ~/.atom/credentials or GITLAB_TOKEN env)")
	deployCmd.Flags().StringVar(&deployBranch, "branch", "", "Branch to build from (overrides atom_agent.yaml ci.branch)")
}

func runDeploy(_ *cobra.Command, _ []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	// Read atom_agent.yaml if present; fall back to flag/env-only mode.
	agentCfg, _ := readAgentConfig()

	// Determine CI mode: --ci flag > atom_agent.yaml > default "local"
	ciMode := deployCIMode
	if ciMode == "" && agentCfg != nil && agentCfg.CI.Provider != "" {
		ciMode = agentCfg.CI.Provider
	}
	if ciMode == "" {
		ciMode = "local"
	}

	switch ciMode {
	case "local", "gitlab":
		// supported
	case "github":
		return fmt.Errorf("ci.provider \"github\" is not yet supported — use \"local\" or \"gitlab\"")
	default:
		return fmt.Errorf("unknown ci.provider %q; choose local or gitlab", ciMode)
	}

	// Resolve agent ID: flag > atom_agent.yaml > .env > prompt
	agentID := deployAgentID
	if agentID == "" && agentCfg != nil {
		agentID = agentCfg.AgentID
	}
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

	// Resolve deployment message
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

	sdkImage := ""
	if agentCfg != nil {
		sdkImage = agentCfg.SDKImage
	}

	var image string
	switch ciMode {
	case "local":
		image, err = runLocalBuild(sdkImage)
		if err != nil {
			return err
		}

	case "gitlab":
		origin := "gl_origin"
		if agentCfg != nil && agentCfg.CI.Origin != "" {
			origin = agentCfg.CI.Origin
		}
		branch := deployBranch
		if branch == "" && agentCfg != nil && agentCfg.CI.Branch != "" {
			branch = agentCfg.CI.Branch
		}
		if branch == "" {
			branch = "main"
		}
		image, err = runGitLabBuild(origin, branch, sdkImage)
		if err != nil {
			return err
		}
	}

	// Submit to atom-studio
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

func runLocalBuild(sdkImage string) (string, error) {
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
	var buildArgs []string
	if sdkImage != "" {
		buildArgs = append(buildArgs, "--build-arg", "SDK_IMAGE="+sdkImage)
	}
	if err := deploy.BuildImageWithArgs(".", image, buildArgs); err != nil {
		return "", err
	}
	fmt.Printf("✓ Image built: %s\n\n", image)
	return image, nil
}

func runGitLabBuild(origin, branch, sdkImage string) (string, error) {
	// Resolve repo URL from the named git remote
	repoURL, err := remoteURL(origin)
	if err != nil {
		return "", fmt.Errorf(
			"cannot read git remote %q: %w\n  (set ci.origin in atom_agent.yaml or pass --repo)",
			origin, err)
	}

	host := gitLabHost(repoURL)
	projectPath := gitLabProjectPath(repoURL)

	// Resolve token: --token flag > credentials file > GITLAB_TOKEN env > prompt
	token := deployCIToken
	if token == "" {
		token = ci.GetGitLabToken(host)
	}
	if token == "" {
		token = os.Getenv("GITLAB_TOKEN")
	}
	if token == "" {
		fmt.Println("✗ No GitLab credentials found.")
		token, err = (&promptui.Prompt{
			Label: "GitLab personal access token (scope: api)",
			Mask:  '*',
			Validate: func(s string) error {
				if strings.TrimSpace(s) == "" {
					return fmt.Errorf("required")
				}
				return nil
			},
		}).Run()
		if err != nil {
			return "", err
		}
		token = strings.TrimSpace(token)
		if saveErr := ci.SaveGitLabToken(host, token); saveErr != nil {
			fmt.Printf("⚠  Could not save credentials: %s\n", saveErr)
		} else {
			home, _ := os.UserHomeDir()
			fmt.Printf("  Credentials saved to %s/.atom/credentials (chmod 600)\n", home)
		}
	}

	// Warn if sdk_image is in a different GitLab group (may need deploy token)
	if sdkImage != "" {
		if msg := ci.CrossGroupWarning(sdkImage, projectPath); msg != "" {
			fmt.Println(msg)
		}
	}

	imageTag := gitHeadSHA()
	gl := &ci.GitLab{Token: token}

	fmt.Printf("→ Triggering GitLab CI pipeline on %s (branch: %s, tag: %s) ...\n", repoURL, branch, imageTag)
	pipelineID, pipelineURL, imageRef, err := gl.TriggerBuild(repoURL, branch, imageTag, sdkImage)
	if err != nil {
		return "", fmt.Errorf("trigger GitLab pipeline: %w\n  Ensure .gitlab-ci.yml has the ATOM_BUILD rule (atom create generates this)", err)
	}
	fmt.Printf("  Pipeline: %s\n", pipelineURL)
	fmt.Printf("  Image:    %s (available after build)\n", imageRef)
	fmt.Printf("→ Waiting for pipeline to complete (up to 30 min) ...\n")

	if err := gl.WaitForBuild(repoURL, pipelineID, pipelineURL, 30*time.Minute); err != nil {
		return "", fmt.Errorf("GitLab build failed: %w", err)
	}
	fmt.Printf("✓ GitLab CI build complete\n\n")
	return imageRef, nil
}

// remoteURL returns the fetch URL for the named git remote.
func remoteURL(remoteName string) (string, error) {
	if deployRepo != "" {
		return deployRepo, nil
	}
	out, err := exec.Command("git", "remote", "get-url", remoteName).Output()
	if err != nil {
		return "", fmt.Errorf("git remote get-url %s: %w", remoteName, err)
	}
	remote := strings.TrimSpace(string(out))
	// Normalise SSH → HTTPS
	if strings.HasPrefix(remote, "git@") {
		remote = strings.Replace(remote, ":", "/", 1)
		remote = strings.Replace(remote, "git@", "https://", 1)
	}
	return remote, nil
}

// resolveRepoURL is kept for the legacy --ci github path.
func resolveRepoURL(flagValue, expectedHost string) (string, error) {
	if flagValue != "" {
		return flagValue, nil
	}
	out, err := exec.Command("git", "remote", "get-url", "origin").Output()
	if err != nil {
		return "", fmt.Errorf("could not detect repo URL from git remote; pass --repo explicitly")
	}
	remote := strings.TrimSpace(string(out))
	if strings.HasPrefix(remote, "git@") {
		remote = strings.Replace(remote, ":", "/", 1)
		remote = strings.Replace(remote, "git@", "https://", 1)
	}
	if !strings.Contains(remote, expectedHost) {
		return "", fmt.Errorf("git remote %q is not a %s URL; pass --repo explicitly", remote, expectedHost)
	}
	return remote, nil
}

func gitLabHost(repoURL string) string {
	u, _ := url.Parse(repoURL)
	return u.Host
}

func gitLabProjectPath(repoURL string) string {
	u, _ := url.Parse(repoURL)
	return strings.TrimPrefix(strings.TrimSuffix(u.Path, ".git"), "/")
}

func gitHeadSHA() string {
	out, err := exec.Command("git", "rev-parse", "--short", "HEAD").Output()
	if err != nil {
		return "latest"
	}
	return strings.TrimSpace(string(out))
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

// agentConfig holds the parsed fields from atom_agent.yaml that deploy needs.
type agentConfig struct {
	AgentID  string
	SDKImage string
	CI       struct {
		Provider string
		Origin   string
		Branch   string
	}
}

// readAgentConfig parses atom_agent.yaml from the current directory.
// Returns nil (no error) if the file does not exist.
func readAgentConfig() (*agentConfig, error) {
	data, err := os.ReadFile("atom_agent.yaml")
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	cfg := &agentConfig{}
	cfg.CI.Branch = "main"
	inCI := false
	for _, line := range strings.Split(string(data), "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		indent := len(line) - len(strings.TrimLeft(line, " \t"))
		if indent == 0 {
			inCI = strings.HasPrefix(trimmed, "ci:")
			cfg.AgentID = parseYAMLField(trimmed, "agent_id", cfg.AgentID)
			cfg.SDKImage = parseYAMLField(trimmed, "sdk_image", cfg.SDKImage)
		} else if inCI {
			cfg.CI.Provider = parseYAMLField(trimmed, "provider", cfg.CI.Provider)
			cfg.CI.Origin = parseYAMLField(trimmed, "origin", cfg.CI.Origin)
			cfg.CI.Branch = parseYAMLField(trimmed, "branch", cfg.CI.Branch)
		}
	}
	return cfg, nil
}

// parseYAMLField extracts a scalar value from a "key: value" YAML line.
// Returns current if the line does not match key.
func parseYAMLField(line, key, current string) string {
	prefix := key + ":"
	if !strings.HasPrefix(line, prefix) {
		return current
	}
	val := strings.TrimSpace(strings.TrimPrefix(line, prefix))
	val = strings.Trim(val, `"'`)
	if val == "" {
		return current
	}
	return val
}
