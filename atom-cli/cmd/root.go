package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

var rootCmd = &cobra.Command{
	Use:   "atom",
	Short: "ATOM developer CLI",
	Long: `atom-cli — developer tooling for the ATOM AI governance platform.

Typical workflow:
  atom login                  Authenticate with atom-studio (saved to ~/.atom/config.json)
  atom create                 Scaffold a new agent project with ReAct + atom-sdk
  atom build                  AI-assisted agent builder (intent → capabilities → code)
  atom deploy                 Build image via GitLab CI or locally, then submit for approval
  atom sdk upgrade [tag]      Pin or update the atom-sdk base image in atom_agent.yaml
  atom skills list            Browse available platform skills
  atom tools list             Browse MCP tools registered in atom-llm
  atom logs <agent-id>        Stream live logs from a deployed agent

Registry (docker-compose operator mode):
  Default: ghcr.io/shreyasy2k — set ATOM_IMAGE_REGISTRY in .env to switch to GitLab`,
}

// Execute is called by main.
func Execute() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func init() {
	rootCmd.AddCommand(createCmd)
	rootCmd.AddCommand(loginCmd)
	rootCmd.AddCommand(deployCmd)
	rootCmd.AddCommand(logsCmd)
	rootCmd.AddCommand(sdkCmd)
	rootCmd.AddCommand(buildCmd)
	rootCmd.AddCommand(skillsCmd)
	rootCmd.AddCommand(toolsCmd)
}
