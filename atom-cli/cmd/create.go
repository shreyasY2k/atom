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

	if err := scaffold.Generate(answers); err != nil {
		return err
	}

	fmt.Printf("\n✓ Created ./%s/\n\n", answers.ProjectName)

	// Auto-run setup-dev.sh inside the new project directory.
	setupScript := filepath.Join(answers.ProjectName, "setup-dev.sh")
	fmt.Printf("→ Running setup-dev.sh ...\n\n")
	cmd := exec.Command("bash", setupScript)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		fmt.Printf("\n⚠  setup-dev.sh failed (%s)\n", err)
		fmt.Printf("   Run manually:  cd %s && bash setup-dev.sh\n\n", answers.ProjectName)
	}

	fmt.Printf("\nNext steps:\n")
	fmt.Printf("  cd %s\n", answers.ProjectName)
	fmt.Printf("  source .venv/bin/activate\n")
	fmt.Printf("  # Edit .env — paste ATOM_* values from Studio after creating an agent\n")
	fmt.Printf("  python agent.py         # runs in dev mode\n")
	fmt.Printf("\nWhen ready for production:\n")
	fmt.Printf("  atom-studio → create domain → create agent → copy JWT\n")
	fmt.Printf("  Fill in ATOM_GATE_URL, ATOM_DOMAIN_ID, ATOM_AGENT_ID, ATOM_AGENT_JWT in .env\n")
	fmt.Printf("  ../bin/atom deploy      # submit for HITL approval\n")
	return nil
}
