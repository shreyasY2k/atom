"""Pydantic models for workflow-spec.yaml validation."""

from __future__ import annotations
from typing import Optional, Literal, Any
from pydantic import BaseModel, field_validator, model_validator


class AgentRef(BaseModel):
    name: str
    version: str = "latest"


class RetryConfig(BaseModel):
    max_attempts: int = 3
    backoff: Literal["exponential", "linear", "constant"] = "exponential"


class TaskTemplate(BaseModel):
    title: str
    description: str
    actions: list[Literal["accept", "reject", "edit"]]


class WorkflowNode(BaseModel):
    id: str
    label: str
    type: Literal["agent", "http", "decision", "human_task"]
    next: Optional[str] = None
    branches: Optional[dict[str, Optional[str]]] = None

    @model_validator(mode="before")
    @classmethod
    def coerce_branch_keys(cls, data: Any) -> Any:
        """YAML parses true/false as booleans; normalise to strings."""
        if isinstance(data, dict) and "branches" in data and isinstance(data["branches"], dict):
            data = dict(data)
            data["branches"] = {str(k).lower(): v for k, v in data["branches"].items()}
        return data

    # agent fields
    agent_ref: Optional[AgentRef] = None
    input_mapping: Optional[dict[str, str]] = None
    output_capture: Optional[str] = None
    confidence_threshold: Optional[float] = None
    fallback_node: Optional[str] = None

    # http fields
    method: Optional[Literal["GET", "POST", "PUT", "DELETE", "PATCH"]] = None
    url_template: Optional[str] = None
    headers: Optional[dict[str, str]] = None
    body_template: Optional[dict[str, Any]] = None
    timeout_seconds: int = 30
    retry: Optional[RetryConfig] = None

    # decision fields
    expression: Optional[str] = None

    # human_task fields
    assignee_group: Optional[str] = None
    task_template: Optional[TaskTemplate] = None
    sla_seconds: int = 3600


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
    audit: AuditConfig
    deployment: DeploymentConfig


class WorkflowSpecMetadata(BaseModel):
    name: str
    domain: str
    version: str
    description: str
    owner: str


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
