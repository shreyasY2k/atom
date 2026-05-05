package cmd

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/spf13/cobra"
	"github.com/your-org/atom/atom-cli/internal/scaffold"
	"github.com/your-org/atom/atom-cli/internal/wizard"
)

var createCmd = &cobra.Command{
	Use:   "create",
	Short: "Scaffold a new ReAct agent project",
	Long:  "Interactive wizard that generates a working ReAct agent project using atom-sdk.\nNo flags required — everything is prompted.",
	RunE:  runCreate,
}

func runCreate(_ *cobra.Command, _ []string) error {
	answers, err := wizard.Run()
	if err != nil {
		return err
	}

	// Resolve atom-sdk base image from gl_origin in the ATOM monorepo root.
	// Walk up from cwd to find the root (contains atom-sdk/ subdirectory).
	answers.SDKImage = resolveSDKImage()

	if err := scaffold.Generate(answers); err != nil {
		return err
	}

	fmt.Printf("\n✓ Created ./%s/\n\n", answers.ProjectName)

	if answers.SDKImage != "" {
		fmt.Printf("  sdk_image: %s:latest\n", answers.SDKImage)
		fmt.Printf("  (run `atom sdk upgrade <tag>` inside the project to pin a version)\n\n")
	}

	// Create virtual environment using Python 3.11+ (prefer 3.11 for compatibility)
	pyBin := detectPython()
	fmt.Printf("→ Creating .venv with %s ...\n", pyBin)
	venvCmd := exec.Command(pyBin, "-m", "venv", ".venv")
	venvCmd.Dir = answers.ProjectName
	venvCmd.Stdout = os.Stdout
	venvCmd.Stderr = os.Stderr
	if err := venvCmd.Run(); err != nil {
		fmt.Printf("\n⚠  Could not create .venv: %s\n", err)
		fmt.Printf("   Run manually: cd %s && %s -m venv .venv && .venv/bin/pip install -r requirements.txt\n\n", answers.ProjectName, pyBin)
		printNextSteps(answers.ProjectName)
		return nil
	}

	// Install all dependencies (requirements.txt includes atom-platform-sdk)
	fmt.Printf("→ Installing dependencies (includes atom-platform-sdk) ...\n")
	pipCmd := exec.Command(".venv/bin/pip", "install", "-r", "requirements.txt")
	pipCmd.Dir = answers.ProjectName
	pipCmd.Stdout = os.Stdout
	pipCmd.Stderr = os.Stderr
	if err := pipCmd.Run(); err != nil {
		fmt.Printf("\n⚠  pip install failed: %s\n", err)
		fmt.Printf("   Run manually: cd %s && .venv/bin/pip install -r requirements.txt\n\n", answers.ProjectName)
	} else {
		fmt.Printf("\n✓ .venv ready — atom-platform-sdk installed\n")
	}

	printNextSteps(answers.ProjectName)
	return nil
}

// resolveSDKImage walks up from cwd looking for the ATOM monorepo root
// (identified by the presence of an atom-sdk/ subdirectory) and reads
// gl_origin to derive the registry URL. Returns empty string on failure.
func resolveSDKImage() string {
	cwd, err := os.Getwd()
	if err != nil {
		return ""
	}
	// Walk up the directory tree looking for a directory that contains atom-sdk/
	dir := cwd
	for {
		sdkDir := filepath.Join(dir, "atom-sdk")
		if info, err := os.Stat(sdkDir); err == nil && info.IsDir() {
			img, _ := scaffold.ResolveSDKImage(dir)
			return img
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return ""
}

// detectPython returns the first available Python 3.11+ binary.
// Prefers 3.11 for widest atom-sdk compatibility, falls back to newer versions
// or the generic python3 if no versioned binary is found.
func detectPython() string {
	for _, candidate := range []string{"python3.11", "python3.12", "python3.13", "python3"} {
		if path, err := exec.LookPath(candidate); err == nil && path != "" {
			return candidate
		}
	}
	return "python3"
}

func printNextSteps(project string) {
	fmt.Printf("\nNext steps:\n")
	fmt.Printf("  cd %s\n", project)
	fmt.Printf("  source .venv/bin/activate\n")
	fmt.Printf("  # Edit .env — paste ATOM_* values from Studio after creating a domain + agent\n")
	fmt.Printf("  python agent.py\n")
	fmt.Printf("\nTo deploy:\n")
	fmt.Printf("  atom deploy\n")
}
