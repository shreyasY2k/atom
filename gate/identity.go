package main

import (
	"net/http"
	"strings"
)

type Identity struct {
	ActorID   string
	ActorType string // "human" | "agent" | "system"
}

// extractIdentity parses the X-Atom-Actor header.
// Header format: "<actor_type>:<actor_id>", e.g. "human:user-builder" or "agent:svc-kyc-reviewer".
// Falls back to anonymous human when the header is absent or malformed.
func extractIdentity(r *http.Request) Identity {
	raw := strings.TrimSpace(r.Header.Get("X-Atom-Actor"))
	if raw == "" {
		return Identity{ActorID: "anonymous", ActorType: "human"}
	}
	parts := strings.SplitN(raw, ":", 2)
	if len(parts) == 2 && parts[0] != "" && parts[1] != "" {
		return Identity{ActorType: parts[0], ActorID: parts[1]}
	}
	return Identity{ActorID: raw, ActorType: "human"}
}
