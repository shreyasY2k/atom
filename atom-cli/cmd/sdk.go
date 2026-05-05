package cmd

import (
	"fmt"
	"os"
	"regexp"
	"strings"

	"github.com/spf13/cobra"
)

var sdkCmd = &cobra.Command{
	Use:   "sdk",
	Short: "Manage the atom-sdk base image for this agent",
}

var sdkUpgradeCmd = &cobra.Command{
	Use:   "upgrade [tag]",
	Short: "Update sdk_image tag in atom_agent.yaml",
	Long: `Updates the sdk_image field in atom_agent.yaml to the given tag (default: latest).
The base registry path is preserved; only the tag changes.

Examples:
  atom sdk upgrade              # → :latest
  atom sdk upgrade v0.2.0       # → :v0.2.0`,
	Args: cobra.MaximumNArgs(1),
	RunE: runSDKUpgrade,
}

func init() {
	sdkCmd.AddCommand(sdkUpgradeCmd)
}

func runSDKUpgrade(_ *cobra.Command, args []string) error {
	tag := "latest"
	if len(args) > 0 && strings.TrimSpace(args[0]) != "" {
		tag = strings.TrimSpace(args[0])
	}

	data, err := os.ReadFile("atom_agent.yaml")
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("no atom_agent.yaml in current directory — run atom create first")
		}
		return err
	}

	// Find current sdk_image value
	current := ""
	for _, line := range strings.Split(string(data), "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "sdk_image:") {
			current = strings.TrimSpace(strings.TrimPrefix(trimmed, "sdk_image:"))
			current = strings.Trim(current, `"'`)
			break
		}
	}
	if current == "" {
		return fmt.Errorf("sdk_image not found in atom_agent.yaml")
	}

	// Derive new value: replace tag after last ':'
	base := current
	if idx := strings.LastIndex(current, ":"); idx != -1 {
		base = current[:idx]
	}
	next := base + ":" + tag

	if current == next {
		fmt.Printf("sdk_image already at %s — nothing to do\n", next)
		return nil
	}

	fmt.Printf("sdk_image: %s  →  %s\n", current, next)

	// Replace the sdk_image line in the file (preserve surrounding content)
	re := regexp.MustCompile(`(?m)^(\s*sdk_image:\s*).*$`)
	updated := re.ReplaceAllStringFunc(string(data), func(match string) string {
		prefix := re.FindStringSubmatch(match)[1]
		return prefix + next
	})

	return os.WriteFile("atom_agent.yaml", []byte(updated), 0o644)
}
