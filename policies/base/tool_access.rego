package atom.authz

import future.keywords.if
import future.keywords.in

# Agents may only call tools they have been explicitly provisioned with.
deny[{"reason": "tool not permitted for this agent"}] if {
	startswith(input.request.path, "/tools/")
	tool_name := split(input.request.path, "/")[2]
	not tool_name in input.agent.tools
}
