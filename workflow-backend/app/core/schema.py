"""Pydantic models for workflow-spec.yaml validation."""

from __future__ import annotations
from typing import Optional, Literal, Any
from pydantic import BaseModel, field_validator, model_validator


# ── Shared building blocks ────────────────────────────────────────────────────

class AgentRef(BaseModel):
    name: str
    version: str = "latest"


class RetryConfig(BaseModel):
    max_attempts: int = 3
    backoff: Literal["exponential", "linear", "constant"] = "exponential"
    initial_delay_seconds: float = 1.0
    max_delay_seconds: float = 60.0


class TaskTemplate(BaseModel):
    title: str
    description: str
    actions: list[Literal["accept", "reject", "edit"]]


# ── HTTP-specific extensions ──────────────────────────────────────────────────

class AuthConfig(BaseModel):
    """Per-node HTTP authentication.

    type: bearer  → injects  Authorization: Bearer <token>
    type: basic   → injects  Authorization: Basic base64(username:password)
    type: api_key → injects  <header>: <key>  (header defaults to X-API-Key)
    """
    type: Literal["bearer", "basic", "api_key"]
    token: Optional[str] = None       # bearer
    username: Optional[str] = None    # basic
    password: Optional[str] = None    # basic
    header: str = "X-API-Key"         # api_key
    key: Optional[str] = None         # api_key


class HttpPollConfig(BaseModel):
    """Async polling: POST to trigger → GET until done_condition is true."""
    poll_url_template: str            # URL to poll (may reference ctx)
    interval_seconds: int = 5
    max_attempts: int = 12
    done_condition: str               # ctx expression: e.g. ctx.poll_result.status == "completed"


# ── Decision-specific extensions ──────────────────────────────────────────────

class DecisionCase(BaseModel):
    """One arm of a multi-way decision.

    Cases are evaluated in order; first match wins.
    """
    condition: str     # safe Python expression: ctx.input.amount_usd > 1_000_000
    target: str        # node ID to jump to
    label: Optional[str] = None    # human-readable label (shown on edge in Composer)


# ── Human-task extensions ─────────────────────────────────────────────────────

class EscalationPolicy(BaseModel):
    """What happens when a human_task SLA expires.

    action:
      auto_approve  — resolve with 'accept' and continue
      auto_reject   — resolve with 'reject' and continue
      escalate      — reassign to escalate_to_group (creates a new task)
    """
    action: Literal["auto_approve", "auto_reject", "escalate"] = "auto_reject"
    escalate_to_group: Optional[str] = None   # required when action == escalate


class SkipCondition(BaseModel):
    """Condition under which a human_task is auto-completed without human action.

    Evaluated before the task is created. If true, the node emits
    auto_resolution as the resolution and proceeds to next immediately.
    """
    condition: str                                         # safe Python expression
    auto_resolution: Literal["accept", "reject"] = "accept"


# ── Workflow node (the core model) ────────────────────────────────────────────

class WorkflowNode(BaseModel):
    # ── Universal fields ───────────────────────────────────────────────────────
    id: str
    label: str
    type: Literal["agent", "http", "decision", "human_task"]
    description: Optional[str] = None     # longer documentation string

    # Control flow
    next: Optional[str] = None
    branches: Optional[dict[str, Optional[str]]] = None  # decision true/false shorthand

    # Error handling — node to jump to on unhandled error (overrides workflow-level)
    on_error: Optional[str] = None

    # Timeout — max wall-clock seconds for this node (default varies by type)
    timeout_seconds: int = 300

    # Retry — applies to agent and http nodes
    retry: Optional[RetryConfig] = None

    # Tags — for audit queries and Composer filtering
    tags: list[str] = []

    # ── Agent node ─────────────────────────────────────────────────────────────
    agent_ref: Optional[AgentRef] = None
    input_mapping: Optional[dict[str, str]] = None
    output_capture: Optional[str] = None
    confidence_threshold: Optional[float] = None
    fallback_node: Optional[str] = None

    # ── HTTP node ──────────────────────────────────────────────────────────────
    method: Optional[Literal["GET", "POST", "PUT", "DELETE", "PATCH"]] = None
    url_template: Optional[str] = None
    headers: Optional[dict[str, str]] = None
    body_template: Optional[dict[str, Any]] = None
    auth: Optional[AuthConfig] = None
    # extract: map of output_key → dot-path into response body
    # e.g.  {hit: result.sanctions_hit, score: result.risk_score}
    extract: Optional[dict[str, str]] = None
    # expect_status: list of acceptable HTTP status codes (default: any 2xx)
    expect_status: Optional[list[int]] = None
    # poll: async polling config (triggers after initial call, keeps polling)
    poll: Optional[HttpPollConfig] = None

    # ── Decision node ──────────────────────────────────────────────────────────
    # Binary shorthand (kept for backward compat):
    expression: Optional[str] = None   # evaluated; routes to branches.true or .false

    # Multi-way cases (takes precedence over expression if both are set):
    cases: Optional[list[DecisionCase]] = None
    default: Optional[str] = None   # target if no case matches (required when using cases)

    # ── Human-task node ────────────────────────────────────────────────────────
    assignee_group: Optional[str] = None
    assignee_individual: Optional[str] = None  # specific user (overrides group if both set)
    task_template: Optional[TaskTemplate] = None
    sla_seconds: int = 3600
    priority: Literal["low", "medium", "high", "critical"] = "medium"
    # form_schema: JSON Schema for the review form shown to the human
    form_schema: Optional[dict[str, Any]] = None
    # evidence: list of ctx keys to surface to the reviewer (subset of ctx shown in UI)
    evidence: Optional[list[str]] = None
    escalation_policy: Optional[EscalationPolicy] = None
    skip_if: Optional[SkipCondition] = None

    @model_validator(mode="before")
    @classmethod
    def coerce_branch_keys(cls, data: Any) -> Any:
        """YAML parses true/false branch keys as booleans; normalise to strings."""
        if isinstance(data, dict) and "branches" in data and isinstance(data["branches"], dict):
            data = dict(data)
            data["branches"] = {str(k).lower(): v for k, v in data["branches"].items()}
        return data


# ── Workflow-level models ─────────────────────────────────────────────────────

class InputSchema(BaseModel):
    type: str = "object"
    required: list[str] = []
    properties: dict[str, Any] = {}


class AuditConfig(BaseModel):
    log_to: str
    retention_days: int = 90

    @field_validator("retention_days")
    @classmethod
    def at_least_90(cls, v: int) -> int:
        if v < 90:
            raise ValueError("retention_days must be >= 90 (compliance requirement)")
        return v


class DeploymentConfig(BaseModel):
    runtime: Literal["temporal"] = "temporal"
    task_queue: str


class WorkflowSpecInner(BaseModel):
    input_schema: InputSchema = InputSchema()
    nodes: list[WorkflowNode]
    # Default error handler — node to jump to when any node hits on_error and has none set
    error_handler: Optional[str] = None
    # Hard cap on the whole workflow run (seconds). None = no cap.
    timeout_seconds: Optional[int] = None
    audit: AuditConfig
    deployment: DeploymentConfig


class WorkflowSpecMetadata(BaseModel):
    name: str
    domain: str
    version: str
    description: str
    owner: str
    # layout and sample_inputs are UI/demo metadata; Pydantic ignores them (extra fields allowed)


class WorkflowSpec(BaseModel):
    apiVersion: str
    kind: str = "WorkflowDeployment"
    metadata: WorkflowSpecMetadata
    spec: WorkflowSpecInner

    @field_validator("kind")
    @classmethod
    def must_be_deployment(cls, v: str) -> str:
        if v != "WorkflowDeployment":
            raise ValueError(f"kind must be WorkflowDeployment, got {v!r}")
        return v
