package cmd

import (
	"fmt"

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
	fmt.Printf("Next steps:\n")
	fmt.Printf("  cd %s\n", answers.ProjectName)
	fmt.Printf("  cp .env.example .env    # fill in your LLM_API_KEY\n")
	fmt.Printf("  pip install -r requirements.txt\n")
	fmt.Printf("  python agent.py         # runs in dev mode\n")
	fmt.Printf("\nWhen ready for production:\n")
	fmt.Printf("  atom-studio → create domain → create agent → copy token\n")
	fmt.Printf("  Set ATOM_MODE=prod in .env and fill in ATOM_* vars\n")
	fmt.Printf("  python agent.py\n")
	return nil
}
