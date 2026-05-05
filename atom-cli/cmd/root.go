package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

var rootCmd = &cobra.Command{
	Use:   "atom",
	Short: "ATOM developer CLI",
	Long:  "atom-cli — developer tooling for the ATOM AI governance platform.",
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
