package atom.authz_test

import future.keywords.if

# ── allow: valid agent token calling its own agent ────────────────────────────
test_allow_agent_own_path if {
	allow with input as {
		"token": {
			"type": "agent",
			"agent_id": "agent-123",
			"domain_id": "domain-abc",
			"revoked": false,
		},
		"request": {"path": "/domain/domain-abc/agent/agent-123/run", "method": "POST"},
		"agent": {"tools": [], "skills": []},
	}
}

# ── deny: agent token calling a different agent_id ────────────────────────────
test_deny_agent_wrong_agent_id if {
	not allow with input as {
		"token": {
			"type": "agent",
			"agent_id": "agent-999",
			"domain_id": "domain-abc",
			"revoked": false,
		},
		"request": {"path": "/domain/domain-abc/agent/agent-123/run", "method": "POST"},
		"agent": {"tools": [], "skills": []},
	}
}

# ── deny: revoked agent token ─────────────────────────────────────────────────
test_deny_revoked_token if {
	not allow with input as {
		"token": {
			"type": "agent",
			"agent_id": "agent-123",
			"domain_id": "domain-abc",
			"revoked": true,
		},
		"request": {"path": "/domain/domain-abc/agent/agent-123/run", "method": "POST"},
		"agent": {"tools": [], "skills": []},
	}
}

# ── allow: human admin token ──────────────────────────────────────────────────
test_allow_human_admin if {
	allow with input as {
		"token": {"type": "human", "role": "admin"},
		"request": {"path": "/api/domains", "method": "GET"},
		"agent": {},
	}
}

# ── deny: human token with no role ────────────────────────────────────────────
test_deny_human_no_role if {
	not allow with input as {
		"token": {"type": "human", "role": "viewer"},
		"request": {"path": "/api/domains", "method": "GET"},
		"agent": {},
	}
}

# ── deny: cross-domain access ─────────────────────────────────────────────────
test_deny_cross_domain if {
	deny[{"reason": "cross-domain access denied"}] with input as {
		"token": {
			"type": "agent",
			"agent_id": "agent-123",
			"domain_id": "domain-ATTACKER",
		},
		"request": {"path": "/domain/domain-VICTIM/agent/agent-456/run", "method": "POST"},
		"agent": {},
	}
}

# ── deny: tool not provisioned ────────────────────────────────────────────────
test_deny_unpermitted_tool if {
	deny[{"reason": "tool not permitted for this agent"}] with input as {
		"token": {"type": "agent", "agent_id": "agent-123"},
		"request": {"path": "/tools/send-email", "method": "POST"},
		"agent": {"tools": ["lookup-customer"], "skills": []},
	}
}

# ── allow: provisioned tool access ───────────────────────────────────────────
test_allow_permitted_tool if {
	not deny[{"reason": "tool not permitted for this agent"}] with input as {
		"token": {"type": "agent", "agent_id": "agent-123"},
		"request": {"path": "/tools/lookup-customer", "method": "POST"},
		"agent": {"tools": ["lookup-customer"], "skills": []},
	}
}
