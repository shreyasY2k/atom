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
	Long: `Opens a WebSocket connection to atom-studio and streams live stdout/stderr
from the running agent container. Press Ctrl-C to stop.

The agent must be in 'deployed' status. Agent IDs are shown in atom-studio
under Agents, or in the output of atom deploy.

Example:
  atom logs 3999cf06-d347-4d89-a94c-d605d8447766`,
	Args: cobra.ExactArgs(1),
	RunE: runLogs,
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
