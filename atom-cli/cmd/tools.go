package cmd

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/spf13/cobra"
	"github.com/your-org/atom/atom-cli/internal/config"
)

var toolsCmd = &cobra.Command{
	Use:   "tools",
	Short: "Manage MCP tools",
	Long:  "List and inspect MCP tools available via atom-llm.",
}

var toolsListCmd = &cobra.Command{
	Use:   "list",
	Short: "List available MCP tools from atom-llm",
	RunE:  runToolsList,
}

var toolsShowCmd = &cobra.Command{
	Use:   "show <name>",
	Short: "Show input schema for a tool",
	Args:  cobra.ExactArgs(1),
	RunE:  runToolsShow,
}

func init() {
	toolsCmd.AddCommand(toolsListCmd)
	toolsCmd.AddCommand(toolsShowCmd)
}

func runToolsList(_ *cobra.Command, _ []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	req, err := http.NewRequest("GET", cfg.StudioURL+"/api/tools/", nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.AccessToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusServiceUnavailable || resp.Header.Get("X-ATOM-Tools-Status") == "unavailable" {
		fmt.Println("Tools unavailable — atom-llm is not reachable.")
		return nil
	}

	var tools []struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tools); err != nil {
		return fmt.Errorf("failed to decode response: %w", err)
	}

	if len(tools) == 0 {
		fmt.Println("No MCP tools registered in atom-llm.")
		return nil
	}

	fmt.Printf("%-30s %s\n", "NAME", "DESCRIPTION")
	fmt.Println(fmt.Sprintf("%-30s %s", "----", "-----------"))
	for _, t := range tools {
		desc := t.Description
		if len(desc) > 60 {
			desc = desc[:57] + "..."
		}
		fmt.Printf("%-30s %s\n", t.Name, desc)
	}
	return nil
}

func runToolsShow(_ *cobra.Command, args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	name := args[0]
	req, err := http.NewRequest("GET", cfg.StudioURL+"/api/tools/"+name+"/schema", nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.AccessToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return fmt.Errorf("tool %q not found", name)
	}
	if resp.StatusCode == http.StatusServiceUnavailable {
		return fmt.Errorf("atom-llm is not reachable")
	}
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("server error %d: %s", resp.StatusCode, string(body))
	}

	var schema any
	if err := json.NewDecoder(resp.Body).Decode(&schema); err != nil {
		return fmt.Errorf("failed to decode response: %w", err)
	}

	out, err := json.MarshalIndent(schema, "", "  ")
	if err != nil {
		return err
	}
	fmt.Println(string(out))
	return nil
}
