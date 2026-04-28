package main

// atom-cli — developer CLI for ATOM.
//
// Commands (implemented in SESSION-10):
//   atom login   --studio <url>        store credentials
//   atom create  agent <token>         scaffold agent project from studio token
//   atom validate                      validate atom_agent.yaml in CWD
//   atom deploy  [--image <image>]     build, push, submit deployment for approval
//   atom logs    [--follow]            tail agent logs
//   atom status                        show agent status and HITL queue depth
//
// Build: make cli-build
// Install: make cli-install

import "fmt"

func main() {
	// TODO: implement in SESSION-10
	// Wire Cobra root command and all subcommands.
	fmt.Println("atom-cli — not yet implemented. See sessions/SESSION-10.md")
}
