package wizard

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/manifoldco/promptui"
)

var projectNameRe = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`)

// Provider holds metadata for a supported LLM provider.
type Provider struct {
	Label         string
	Name          string
	DefaultModel  string
	BaseURL       string
	APIKeyVar     string
	APIKeyExample string
}

var providers = []Provider{
	{
		Label:         "OpenAI (needs OPENAI_API_KEY)",
		Name:          "openai",
		DefaultModel:  "gpt-4o",
		BaseURL:       "https://api.openai.com/v1",
		APIKeyVar:     "OPENAI_API_KEY",
		APIKeyExample: "sk-...",
	},
	{
		Label:         "Anthropic (needs ANTHROPIC_API_KEY, proxied via LiteLLM)",
		Name:          "anthropic",
		DefaultModel:  "claude-sonnet-4-20250514",
		BaseURL:       "https://api.anthropic.com",
		APIKeyVar:     "ANTHROPIC_API_KEY",
		APIKeyExample: "sk-ant-...",
	},
	{
		Label:         "Google Gemini (needs GEMINI_API_KEY)",
		Name:          "gemini",
		DefaultModel:  "gemini-2.5-flash",
		BaseURL:       "https://generativelanguage.googleapis.com/v1beta/openai",
		APIKeyVar:     "GEMINI_API_KEY",
		APIKeyExample: "AIza...",
	},
	{
		Label:         "Local atom-llm (needs LITELLM_API_KEY + LITELLM_BASE_URL)",
		Name:          "local",
		DefaultModel:  "gemini-2.5-flash",
		BaseURL:       "http://localhost:4000",
		APIKeyVar:     "LITELLM_API_KEY",
		APIKeyExample: "sk-...",
	},
}

var allTools = []struct {
	Name        string
	Description string
}{
	{Name: "web_search", Description: "search the web (stub)"},
	{Name: "calculator", Description: "evaluate math expressions"},
	{Name: "file_reader", Description: "read a local file by path"},
	{Name: "http_get", Description: "make an HTTP GET request"},
	{Name: "memory_recall", Description: "recall facts from agent memory (stub)"},
}

// Answers collects all wizard responses.
type Answers struct {
	ProjectName string
	Description string
	Provider    Provider
	ModelName   string
	Tools       []string
	UseMemory   bool
	UseHITL     bool
	// SDKImage is the container registry path for the atom-sdk base image,
	// resolved from atom-sdk/gl_origin after the wizard runs. May be empty.
	SDKImage string
}

// Run executes the interactive wizard and returns the collected answers.
func Run() (*Answers, error) {
	a := &Answers{}

	// 1. Project name
	name, err := (&promptui.Prompt{
		Label: "Project name",
		Validate: func(s string) error {
			s = strings.TrimSpace(s)
			if s == "" {
				return fmt.Errorf("required")
			}
			if !projectNameRe.MatchString(s) {
				return fmt.Errorf("lowercase letters, numbers, hyphens only; must start and end with a letter or number")
			}
			return nil
		},
	}).Run()
	if err != nil {
		return nil, err
	}
	a.ProjectName = strings.TrimSpace(name)

	// 2. Description
	desc, err := (&promptui.Prompt{
		Label: "What does this agent do? (one line)",
		Validate: func(s string) error {
			if strings.TrimSpace(s) == "" {
				return fmt.Errorf("required")
			}
			return nil
		},
	}).Run()
	if err != nil {
		return nil, err
	}
	a.Description = strings.TrimSpace(desc)

	// 3. Provider
	providerLabels := make([]string, len(providers))
	for i, p := range providers {
		providerLabels[i] = p.Label
	}
	idx, _, err := (&promptui.Select{
		Label: "LLM provider",
		Items: providerLabels,
	}).Run()
	if err != nil {
		return nil, err
	}
	a.Provider = providers[idx]

	// 4. Model name (pre-filled default)
	model, err := (&promptui.Prompt{
		Label:   "Model name",
		Default: a.Provider.DefaultModel,
	}).Run()
	if err != nil {
		return nil, err
	}
	a.ModelName = strings.TrimSpace(model)
	if a.ModelName == "" {
		a.ModelName = a.Provider.DefaultModel
	}

	// 5. Tools (multi-select; web_search checked by default)
	toolLabels := make([]string, len(allTools))
	for i, t := range allTools {
		toolLabels[i] = t.Name + " — " + t.Description
	}
	selectedIdxs, err := multiSelect("Tools to include (select item to toggle, choose '── Done ──' when finished)", toolLabels, map[int]bool{0: true})
	if err != nil {
		return nil, err
	}
	if len(selectedIdxs) == 0 {
		fmt.Println("  (no tools selected — defaulting to web_search)")
		selectedIdxs = []int{0}
	}
	a.Tools = make([]string, len(selectedIdxs))
	for i, si := range selectedIdxs {
		a.Tools[i] = allTools[si].Name
	}

	// 6. Memory
	_, memErr := (&promptui.Prompt{
		Label:     "Include memory setup? (y/N)",
		IsConfirm: true,
	}).Run()
	if memErr != nil && memErr != promptui.ErrAbort {
		return nil, memErr
	}
	a.UseMemory = (memErr == nil)

	// 7. HITL
	_, hitlErr := (&promptui.Prompt{
		Label:     "Include HITL example? (y/N)",
		IsConfirm: true,
	}).Run()
	if hitlErr != nil && hitlErr != promptui.ErrAbort {
		return nil, hitlErr
	}
	a.UseHITL = (hitlErr == nil)

	// Summary
	fmt.Printf("\n── Summary ──────────────────────────────────────────\n")
	fmt.Printf("  Project:     %s\n", a.ProjectName)
	fmt.Printf("  Description: %s\n", a.Description)
	fmt.Printf("  Provider:    %s\n", a.Provider.Name)
	fmt.Printf("  Model:       %s\n", a.ModelName)
	fmt.Printf("  Tools:       %s\n", strings.Join(a.Tools, ", "))
	fmt.Printf("  Memory:      %v\n", a.UseMemory)
	fmt.Printf("  HITL:        %v\n", a.UseHITL)
	fmt.Printf("─────────────────────────────────────────────────────\n\n")

	// Confirm
	confirm, err := (&promptui.Prompt{
		Label:   "Create project? [Y/n]",
		Default: "Y",
	}).Run()
	if err != nil {
		return nil, err
	}
	if strings.ToLower(strings.TrimSpace(confirm)) == "n" {
		return nil, fmt.Errorf("aborted by user")
	}

	return a, nil
}

// multiSelect renders a toggleable checklist using promptui.Select.
// defaults is a set of pre-selected indices.
func multiSelect(label string, items []string, defaults map[int]bool) ([]int, error) {
	selected := make(map[int]bool, len(defaults))
	for k, v := range defaults {
		selected[k] = v
	}

	for {
		display := make([]string, len(items)+1)
		for i, item := range items {
			if selected[i] {
				display[i] = "[x] " + item
			} else {
				display[i] = "[ ] " + item
			}
		}
		display[len(items)] = "── Done ──"

		idx, _, err := (&promptui.Select{
			Label: label,
			Items: display,
			Size:  len(items) + 2,
		}).Run()
		if err != nil {
			return nil, err
		}
		if idx == len(items) {
			break
		}
		selected[idx] = !selected[idx]
	}

	var result []int
	for i := range items {
		if selected[i] {
			result = append(result, i)
		}
	}
	return result, nil
}
