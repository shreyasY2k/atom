package atom.authz

import future.keywords.if

# Agent tokens may only call agents within their own domain.
# Cross-domain calls are always denied regardless of other permissions.
deny[{"reason": "cross-domain access denied"}] if {
	input.token.type == "agent"
	input.token.domain_id != path_domain_id
}

# ── Helpers ───────────────────────────────────────────────────────────────────

path_domain_id := domain_id if {
	# Path format: /domain/{domain_id}/agent/{agent_id}/...
	parts := split(input.request.path, "/")
	count(parts) >= 3
	domain_id := parts[2]
}
