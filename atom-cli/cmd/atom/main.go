package main

// atom-cli — developer CLI for ATOM.
//
// Commands:
//   atom create                        scaffold a ReAct agent project (interactive wizard)
//   atom login   --studio <url>        store credentials          (future)
//   atom validate                      validate atom_agent.yaml   (future)
//   atom deploy  [--image <image>]     build, push, deploy        (future)
//   atom logs    [--follow]            tail agent logs            (future)
//   atom status                        agent status + HITL queue  (future)
//
// Build: go build -o atom ./cmd/atom

import "github.com/your-org/atom/atom-cli/cmd"

func main() {
	cmd.Execute()
}
