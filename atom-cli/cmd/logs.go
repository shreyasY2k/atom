package cmd

import (
	"fmt"
	"strings"

	"github.com/spf13/cobra"
	"github.com/your-org/atom/atom-cli/internal/config"
	agentlogs "github.com/your-org/atom/atom-cli/internal/logs"
)

var logsCmd = &cobra.Command{
	Use:   "logs <agent-id>",
	Short: "Stream live logs from a deployed agent",
	Args:  cobra.ExactArgs(1),
	RunE:  runLogs,
}

func runLogs(_ *cobra.Command, args []string) error {
	agentID := strings.TrimSpace(args[0])

	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fmt.Printf("Streaming logs for agent %s\n", agentID)
	return agentlogs.Stream(cfg.StudioURL, agentID, cfg.AccessToken)
}
