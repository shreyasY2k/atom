package atom.authz

import future.keywords.if
import future.keywords.in

default allow := false

# Agent tokens: allowed if token matches the agent being called and is not revoked
allow if {
	input.token.type == "agent"
	input.token.agent_id == path_agent_id
	not is_revoked
}

# Human tokens: allowed for admin or developer roles (studio + CLI access)
allow if {
	input.token.type == "human"
	input.token.role in {"admin", "developer"}
}

# ── Helpers ───────────────────────────────────────────────────────────────────

path_agent_id := agent_id if {
	# Path format: /domain/{domain_id}/agent/{agent_id}/...
	parts := split(input.request.path, "/")
	count(parts) >= 5
	agent_id := parts[4]
}

is_revoked if {
	input.token.revoked == true
}
