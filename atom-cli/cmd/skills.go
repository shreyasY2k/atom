package cmd

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"

	"github.com/spf13/cobra"
	"github.com/your-org/atom/atom-cli/internal/config"
)

var skillsCmd = &cobra.Command{
	Use:   "skills",
	Short: "Manage agent skills",
	Long: `Browse and inspect agent skills registered on the ATOM platform.

Skills are knowledge bundles (SKILL.md + supporting files) that get injected
into an agent's system prompt at runtime. They are registered in atom-studio
and referenced by name in atom_agent.yaml or via atom build.`,
}

var skillsListCmd = &cobra.Command{
	Use:   "list",
	Short: "List all available skills",
	Long: `Lists all skills registered in atom-studio, showing name, whether it is
a built-in platform skill, and its description.`,
	RunE: runSkillsList,
}

var skillsShowCmd = &cobra.Command{
	Use:   "show <name>",
	Short: "Show SKILL.md content for a skill",
	Long: `Prints the full SKILL.md content for the named skill — useful for
reviewing what context a skill injects into the agent system prompt.

Example:
  atom skills show atom-gate-calls`,
	Args: cobra.ExactArgs(1),
	RunE: runSkillsShow,
}

func init() {
	skillsCmd.AddCommand(skillsListCmd)
	skillsCmd.AddCommand(skillsShowCmd)
}

func runSkillsList(_ *cobra.Command, _ []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	req, err := http.NewRequest("GET", cfg.StudioURL+"/api/skills/", nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.AccessToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("server error %d: %s", resp.StatusCode, string(body))
	}

	var skills []struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Builtin     bool   `json:"builtin"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&skills); err != nil {
		return fmt.Errorf("failed to decode response: %w", err)
	}

	if len(skills) == 0 {
		fmt.Println("No skills registered.")
		return nil
	}

	fmt.Printf("%-30s %-8s %s\n", "NAME", "BUILTIN", "DESCRIPTION")
	fmt.Println(fmt.Sprintf("%-30s %-8s %s", "----", "-------", "-----------"))
	for _, s := range skills {
		builtin := ""
		if s.Builtin {
			builtin = "yes"
		}
		desc := s.Description
		if len(desc) > 60 {
			desc = desc[:57] + "..."
		}
		fmt.Printf("%-30s %-8s %s\n", s.Name, builtin, desc)
	}
	return nil
}

func runSkillsShow(_ *cobra.Command, args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	name := args[0]
	req, err := http.NewRequest("GET", cfg.StudioURL+"/api/skills/"+name+"/content", nil)
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
		return fmt.Errorf("skill %q not found", name)
	}
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("server error %d: %s", resp.StatusCode, string(body))
	}

	_, err = io.Copy(os.Stdout, resp.Body)
	return err
}
