"""Pydantic models for agent-spec.yaml validation."""

from __future__ import annotations
import logging
from typing import Optional, Literal, Any
from pydantic import BaseModel, field_validator, model_validator

logger = logging.getLogger(__name__)


class MemoryCrossConversation(BaseModel):
    enabled: bool = False
    kind: Optional[Literal["personal", "task"]] = None
    identity_field: Optional[str] = None
    task_key: Optional[str] = None


class MemoryConfig(BaseModel):
    type: Literal["short_term", "long_term"] = "short_term"
    cross_conversation: Optional[MemoryCrossConversation] = None


class AgentConfig(BaseModel):
    name: str
    role: Literal["standalone", "maker", "checker"]   # agent role in the flow (unchanged)

    # ── Role / Skill file (one of these must be set) ────────────────────────
    # "role" is the new canonical field; "skill" is deprecated (compat shim).
    skill: Optional[str] = None   # DEPRECATED — use agent_role_file instead
    agent_role_file: Optional[str] = None   # populated from spec "role: path/to.role.md"

    # ── Reasoning ───────────────────────────────────────────────────────────
    reasoning_mode: Literal["prescribed", "guided"] = "prescribed"

    # ── Model ───────────────────────────────────────────────────────────────
    model: Literal["gemini-3.1-pro", "gemini-3-flash"]
    temperature: float = 1.0
    reasoning_effort: Literal["low", "medium", "high"] = "medium"
    max_iterations: int = 6

    # ── Capabilities ────────────────────────────────────────────────────────
    tools: list[str]
    agentscope_skills: list[str] = []

    # ── Input schema (for free-text extraction adapter) ─────────────────────
    input_schema: Optional[dict[str, Any]] = None

    # ── Sample prompts (shown in Builder Test panel) ─────────────────────────
    sample_prompts: list[str] = []

    # ── Memory ──────────────────────────────────────────────────────────────
    memory: Optional[MemoryConfig] = None

    @field_validator("temperature")
    @classmethod
    def must_be_one(cls, v: float) -> float:
        if v != 1.0:
            raise ValueError("temperature must be 1.0 for Gemini 3 (invariant)")
        return v

    @field_validator("agentscope_skills")
    @classmethod
    def validate_upstream_skills(cls, v: list[str]) -> list[str]:
        from app.core.upstream_skills import validate_skills
        errors = validate_skills(v)
        if errors:
            raise ValueError("; ".join(errors))
        return v

    @model_validator(mode="before")
    @classmethod
    def resolve_role_file(cls, data: Any) -> Any:
        """Accept either 'agent_role_file' (new) or legacy 'skill' field.

        The YAML field name for the role/skill file is overloaded:
          - new spec:  agent_role_file: agent-roles/ats/kyc-refresh.role.md
          - old spec:  skill: skills/ats/kyc-refresh.skill.md
        """
        if not isinstance(data, dict):
            return data
        # New canonical field wins if present
        if data.get("agent_role_file"):
            return data
        # Compat: if "skill" is set, copy to agent_role_file with deprecation log
        if data.get("skill"):
            logger.warning(
                "Agent spec uses deprecated 'skill:' field — rename to 'agent_role_file:'. "
                "Support for 'skill:' will be removed in a future release."
            )
            data = dict(data)
            data["agent_role_file"] = data["skill"]
        return data

    def effective_role_path(self) -> str:
        """Return the resolved path to the role/skill file."""
        return self.agent_role_file or self.skill or ""


class FlowHandoff(BaseModel):
    from_: str
    to: str
    condition: str

    model_config = {"populate_by_name": True}

    @classmethod
    def model_validate(cls, obj, **kwargs):
        if isinstance(obj, dict) and "from" in obj:
            obj = {**obj, "from_": obj.pop("from")}
        return super().model_validate(obj, **kwargs)


class RevisionLoop(BaseModel):
    enabled: bool = False
    max_revisions: int = 2


class FlowConfig(BaseModel):
    type: Literal["standalone", "maker-checker"]
    handoff: Optional[dict] = None
    revision_loop: Optional[RevisionLoop] = None


class AuditConfig(BaseModel):
    log_to: str
    retention_days: int = 90


class DeploymentConfig(BaseModel):
    runtime: str = "agentscope"
    sandbox: str = "base"
    replicas: int = 1


class GuardrailsConfig(BaseModel):
    agentarmor: bool = True


class AgentSpecInner(BaseModel):
    agents: list[AgentConfig]
    flow: FlowConfig
    audit: AuditConfig
    deployment: DeploymentConfig
    guardrails: GuardrailsConfig = GuardrailsConfig()


class AgentSpecMetadata(BaseModel):
    name: str
    domain: str
    version: str
    description: str
    owner: str


class AgentSpec(BaseModel):
    apiVersion: str
    kind: str = "AgentDeployment"
    metadata: AgentSpecMetadata
    spec: AgentSpecInner

    @field_validator("kind")
    @classmethod
    def must_be_deployment(cls, v: str) -> str:
        if v != "AgentDeployment":
            raise ValueError(f"kind must be AgentDeployment, got {v!r}")
        return v
