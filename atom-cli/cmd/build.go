package cmd

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"text/template"
	"time"

	"github.com/spf13/cobra"
	"github.com/your-org/atom/atom-cli/internal/config"
)

var (
	buildIntent string
	buildOutput string
	buildDeploy bool
)

var buildCmd = &cobra.Command{
	Use:   "build",
	Short: "Build an agent from intent (AI-assisted)",
	Long: `Interactive wizard that analyses your agent intent with Gemini and suggests
capabilities (model, skills, MCP tools, A2A agents).

By default, generates code locally. Use --deploy to trigger GitLab CI + approval flow.

Examples:
  atom build
  atom build --intent "Monitor credit applications and escalate high-risk ones"
  atom build --intent "..." --deploy
  atom build --intent "..." --output ./my-agent`,
	RunE: runBuild,
}

func init() {
	buildCmd.Flags().StringVar(&buildIntent, "intent", "", "Agent intent (skips interactive prompt)")
	buildCmd.Flags().StringVar(&buildOutput, "output", "", "Output directory (default: ./<agent-name>)")
	buildCmd.Flags().BoolVar(&buildDeploy, "deploy", false, "Trigger GitLab CI pipeline + approval after scaffolding")
}

type intentSuggestion struct {
	Model     string   `json:"model"`
	Skills    []string `json:"skills"`
	Tools     []string `json:"tools"`
	Reasoning string   `json:"reasoning"`
}

func runBuild(_ *cobra.Command, _ []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	intent := buildIntent
	if intent == "" {
		fmt.Print("? What should this agent do?\n> ")
		reader := bufio.NewReader(os.Stdin)
		intent, err = reader.ReadString('\n')
		if err != nil {
			return fmt.Errorf("failed to read input: %w", err)
		}
		intent = strings.TrimSpace(intent)
	}

	if intent == "" {
		return fmt.Errorf("intent cannot be empty")
	}

	fmt.Println("\n⠋ Analysing intent...")

	// Get domain list
	domains, err := fetchDomains(cfg)
	if err != nil || len(domains) == 0 {
		return fmt.Errorf("could not fetch domains: %w", err)
	}
	domainID := domains[0]["id"].(string)

	// Analyse intent
	suggestion, err := analyseIntent(cfg, intent, domainID)
	if err != nil {
		fmt.Fprintf(os.Stderr, "⚠ Intent analysis unavailable, using defaults: %v\n", err)
		suggestion = &intentSuggestion{
			Model:  "gemini-2.5-flash",
			Skills: []string{"atom-gate-calls", "atom-audit", "atom-react-agent"},
		}
	}

	// Display suggestions
	fmt.Println("\n✓ Suggested:")
	fmt.Printf("  🧠 Skills:  %s\n", strings.Join(suggestion.Skills, "  "))
	if len(suggestion.Tools) > 0 {
		fmt.Printf("  🔧 Tools:   %s\n", strings.Join(suggestion.Tools, "  "))
	}
	fmt.Printf("  🤖 Model:   %s\n", suggestion.Model)
	if suggestion.Reasoning != "" {
		fmt.Printf("  💡 %s\n", suggestion.Reasoning)
	}

	// Choose build destination
	target := "local"
	if buildDeploy {
		target = "gitlab"
	} else if buildIntent == "" {
		// Interactive: ask
		fmt.Println("\n? Choose build destination:")
		fmt.Println("  1) Local only (generate code — deploy later with atom deploy)")
		fmt.Println("  2) GitLab CI (generate + trigger pipeline + submit for approval)")
		fmt.Print("> ")
		reader := bufio.NewReader(os.Stdin)
		choice, _ := reader.ReadString('\n')
		if strings.TrimSpace(choice) == "2" {
			target = "gitlab"
		}
	}

	// Determine output directory
	agentName := sanitizeName(intent)
	outDir := buildOutput
	if outDir == "" {
		outDir = "./" + agentName
	}

	// Scaffold
	if err := scaffoldAgent(outDir, agentName, suggestion, intent); err != nil {
		return fmt.Errorf("scaffolding failed: %w", err)
	}

	fmt.Printf("\n✓ Scaffolded at %s/\n", outDir)
	fmt.Printf("  agent.py  atom_agent.yaml  Dockerfile  requirements.txt\n")

	if target == "gitlab" {
		fmt.Println("\n⠋ Triggering build + approval workflow...")
		if err := triggerBuildAndDeploy(cfg, intent, suggestion, domainID); err != nil {
			return fmt.Errorf("deploy failed: %w", err)
		}
		fmt.Println("✓ Build submitted. Check ATOM Studio → Agents for approval status.")
	}

	return nil
}

func fetchDomains(cfg *config.Config) ([]map[string]any, error) {
	req, err := http.NewRequest("GET", cfg.StudioURL+"/api/domains/", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.AccessToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var domains []map[string]any
	json.NewDecoder(resp.Body).Decode(&domains)
	return domains, nil
}

func analyseIntent(cfg *config.Config, intent, domainID string) (*intentSuggestion, error) {
	payload, _ := json.Marshal(map[string]string{
		"intent":    intent,
		"domain_id": domainID,
	})
	req, err := http.NewRequest("POST", cfg.StudioURL+"/api/builder/analyse-intent", bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.AccessToken)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var suggestion intentSuggestion
	if err := json.NewDecoder(resp.Body).Decode(&suggestion); err != nil {
		return nil, err
	}
	return &suggestion, nil
}

func triggerBuildAndDeploy(cfg *config.Config, intent string, s *intentSuggestion, domainID string) error {
	payload, _ := json.Marshal(map[string]any{
		"intent":    intent,
		"model":     s.Model,
		"mcp_tools": s.Tools,
		"skills":    s.Skills,
		"a2a_links": []string{},
		"domain_id": domainID,
		"ci_config": map[string]string{"target": "gitlab"},
	})
	req, err := http.NewRequest("POST", cfg.StudioURL+"/api/agents/build-and-deploy", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.AccessToken)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("server error %d: %s", resp.StatusCode, string(body))
	}
	return nil
}

const agentPyTmpl = `import agentscope
from agentscope.agent import ReActAgent
from atom_platform_sdk import AtomChatModel, Toolkit

agentscope.init(model_configs=[AtomChatModel.default_config()])

toolkit = Toolkit()
{{- range .Skills}}
toolkit.register_agent_skill("/atom-sdk/skills/{{.}}")
{{- end}}

agent = ReActAgent(
    name="{{.Name}}",
    sys_prompt="{{.Intent}}\n\n" + toolkit.get_agent_skill_prompt(),
    model_config_name="atom-default",
    tools=toolkit.get_tools(),
)

if __name__ == "__main__":
    from agentscope.message import Msg
    msg = Msg(name="user", content="Hello!", role="user")
    result = agent(msg)
    print(result.content)
`

const atomAgentYamlTmpl = `# atom_agent.yaml — fill in agent_id and domain_id from ATOM Studio after creating the agent
agent_id: ""
domain_id: ""
model: {{.Model}}
ci_provider: gitlab
sdk_image: ""
`

const dockerfileTmpl = `ARG SDK_IMAGE=atom-sdk:latest
FROM ${SDK_IMAGE} AS sdk

FROM python:3.11-slim
WORKDIR /app

COPY --from=sdk /atom-sdk /atom-sdk
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PYTHONUNBUFFERED=1
CMD ["python", "agent.py"]
`

const requirementsTmpl = `agentscope>=0.1.0
fastapi>=0.110.0
uvicorn>=0.29.0
`

func scaffoldAgent(outDir, name string, s *intentSuggestion, intent string) error {
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return err
	}

	data := struct {
		Name   string
		Intent string
		Model  string
		Skills []string
	}{
		Name:   name,
		Intent: intent,
		Model:  s.Model,
		Skills: s.Skills,
	}

	files := map[string]string{
		"agent.py":         agentPyTmpl,
		"atom_agent.yaml":  atomAgentYamlTmpl,
		"Dockerfile":       dockerfileTmpl,
		"requirements.txt": requirementsTmpl,
	}

	for filename, tmplStr := range files {
		tmpl, err := template.New(filename).Parse(tmplStr)
		if err != nil {
			return fmt.Errorf("template %s: %w", filename, err)
		}
		f, err := os.Create(outDir + "/" + filename)
		if err != nil {
			return err
		}
		defer f.Close()
		if err := tmpl.Execute(f, data); err != nil {
			return fmt.Errorf("render %s: %w", filename, err)
		}
	}
	return nil
}

func sanitizeName(intent string) string {
	words := strings.Fields(strings.ToLower(intent))
	if len(words) > 3 {
		words = words[:3]
	}
	result := strings.Join(words, "-")
	var out strings.Builder
	for _, c := range result {
		if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' {
			out.WriteRune(c)
		}
	}
	s := out.String()
	if s == "" {
		return "my-agent"
	}
	return s
}
