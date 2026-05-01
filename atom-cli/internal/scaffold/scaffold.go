package scaffold

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"text/template"

	"github.com/your-org/atom/atom-cli/internal/wizard"
	tmplFS "github.com/your-org/atom/atom-cli/templates"
)

// TemplateData is passed to every agent template.
type TemplateData struct {
	ProjectName     string
	Description     string
	ModelName       string
	Provider        string
	ProviderBaseURL string
	APIKeyVar       string
	APIKeyExample   string
	IsLocal         bool
	// Per-tool flags
	HasWebSearch    bool
	HasCalculator   bool
	HasFileReader   bool
	HasHTTPGet      bool
	HasMemoryRecall bool
	// Feature flags
	UseMemory bool
	UseHITL   bool
}

// Generate writes the scaffolded project into a new directory named after the project.
func Generate(a *wizard.Answers) error {
	if _, err := os.Stat(a.ProjectName); err == nil {
		return fmt.Errorf("directory %q already exists", a.ProjectName)
	}
	if err := os.MkdirAll(a.ProjectName, 0o755); err != nil {
		return fmt.Errorf("create directory: %w", err)
	}

	data := buildData(a)

	// outFile → template path (relative to embedded FS root)
	files := map[string]string{
		"agent.py":         "agent/agent.py.tmpl",
		"server.py":        "agent/server.py.tmpl",
		"tools.py":         "agent/tools.py.tmpl",
		"config.py":        "agent/config.py.tmpl",
		"requirements.txt": "agent/requirements.txt.tmpl",
		".env.example":     "agent/env.example.tmpl",
		".gitignore":       "agent/gitignore.tmpl",
		"README.md":        "agent/README.md.tmpl",
		"Dockerfile":       "agent/Dockerfile.tmpl",
		"setup-dev.sh":     "agent/setup-dev.sh.tmpl",
	}

	for outFile, tmplPath := range files {
		if err := renderTemplate(a.ProjectName, outFile, tmplPath, data); err != nil {
			return fmt.Errorf("render %s: %w", outFile, err)
		}
	}

	// .env is a copy of .env.example (values left empty by the developer)
	if err := copyFile(
		filepath.Join(a.ProjectName, ".env.example"),
		filepath.Join(a.ProjectName, ".env"),
	); err != nil {
		return fmt.Errorf("create .env: %w", err)
	}

	// Make setup-dev.sh executable
	if err := os.Chmod(filepath.Join(a.ProjectName, "setup-dev.sh"), 0o755); err != nil {
		return fmt.Errorf("chmod setup-dev.sh: %w", err)
	}

	return nil
}

func buildData(a *wizard.Answers) TemplateData {
	toolSet := make(map[string]bool, len(a.Tools))
	for _, t := range a.Tools {
		toolSet[t] = true
	}
	return TemplateData{
		ProjectName:     a.ProjectName,
		Description:     a.Description,
		ModelName:       a.ModelName,
		Provider:        a.Provider.Name,
		ProviderBaseURL: a.Provider.BaseURL,
		APIKeyVar:       a.Provider.APIKeyVar,
		APIKeyExample:   a.Provider.APIKeyExample,
		IsLocal:         a.Provider.Name == "local",
		HasWebSearch:    toolSet["web_search"],
		HasCalculator:   toolSet["calculator"],
		HasFileReader:   toolSet["file_reader"],
		HasHTTPGet:      toolSet["http_get"],
		HasMemoryRecall: toolSet["memory_recall"],
		UseMemory:       a.UseMemory,
		UseHITL:         a.UseHITL,
	}
}

var tmplFuncs = template.FuncMap{
	// pystr escapes a string for safe embedding inside a Python double-quoted string literal.
	"pystr": func(s string) string {
		s = strings.ReplaceAll(s, `\`, `\\`)
		s = strings.ReplaceAll(s, `"`, `\"`)
		return s
	},
}

func renderTemplate(dir, outFile, tmplPath string, data TemplateData) error {
	raw, err := tmplFS.AgentFS.ReadFile(tmplPath)
	if err != nil {
		return fmt.Errorf("read template %s: %w", tmplPath, err)
	}

	tmpl, err := template.New(outFile).Funcs(tmplFuncs).Parse(string(raw))
	if err != nil {
		return fmt.Errorf("parse template %s: %w", tmplPath, err)
	}

	f, err := os.Create(filepath.Join(dir, outFile))
	if err != nil {
		return err
	}
	defer f.Close()

	return tmpl.Execute(f, data)
}

func copyFile(src, dst string) error {
	content, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, content, 0o644)
}
