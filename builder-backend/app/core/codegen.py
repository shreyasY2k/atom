"""
Spec → agent.py code generation via Gemini 3.1 Pro through LiteLLM.

Flow:
  1. Load builder SKILL.md as system prompt (with FastAPI override note)
  2. Build user message from spec YAML + domain skill file
  3. Call Gemini via LiteLLM
  4. Extract Python block, ast.parse, lint-check
  5. Retry once on failure
"""

import ast
import hashlib
import os
import re
import textwrap
from pathlib import Path

import yaml

from app.core.litellm_client import chat_completion
from app.core.schema import AgentSpec

SKILLS_PATH    = Path(os.environ.get("SKILLS_PATH", "/app/skills"))
SPECS_PATH     = Path(os.environ.get("SPECS_PATH", "/app/specs"))
AGENT_ROLES_PATH = Path(os.environ.get("AGENT_ROLES_PATH", "/app/agent-roles"))

# Required patterns for the lint gate
_REQUIRED_PATTERNS = [
    (r"from agentscope", "must import from agentscope"),
    (r"LITELLM_BASE_URL", "must read LITELLM_BASE_URL from env"),
    (r"SERVICE_ACCOUNT_ID", "must read SERVICE_ACCOUNT_ID from env"),
    (r"from tools\.registry import resolve_tools", "must import resolve_tools"),
    (r"temperature=1\.0", "must set temperature=1.0"),
    (r'"actor_type"', "must include actor_type in metadata"),
    (r'"actor_id"', "must include actor_id in metadata"),
    (r'"user".*SERVICE_ACCOUNT_ID|SERVICE_ACCOUNT_ID.*"user"', 'must pass "user": SERVICE_ACCOUNT_ID to satisfy enforce_user_param'),
    (r'_as_tool_response|ToolResponse', "must wrap tool functions to return ToolResponse objects"),
    (r'agentscope\.init\(', "must call agentscope.init() to register with Studio"),
    (r"if __name__", "must have __main__ block"),
    (r"FastAPI\(", "must use FastAPI for HTTP serving"),
    (r'@app\.post\(["\']\/invoke', "must define /invoke endpoint"),
    (r'@app\.get\(["\']\/health', "must define /health endpoint"),
]

_FORBIDDEN_PATTERNS = [
    (r"import google\.generativeai", "must not import google.generativeai directly"),
    (r"GEMINI_API_KEY", "must not reference GEMINI_API_KEY (use LITELLM_API_KEY)"),
    (r'SKILL\s*=\s*"""', "skill content must be loaded from file, not embedded as triple-quoted string"),
    (r"SKILL\s*=\s*'''", "skill content must be loaded from file, not embedded as triple-quoted string"),
]

_FASTAPI_OVERRIDE = textwrap.dedent("""
    ## IMPORTANT IMPLEMENTATION OVERRIDE

    `agentscope_runtime.engine.agent_app.AgentApp` does NOT exist in the installed
    runtime. Use FastAPI instead. The required pattern:

    ```python
    from fastapi import FastAPI
    import uvicorn
    app = FastAPI(title="<agent-name>", version="<version>")

    @app.get("/health")
    def health():
        return {"status": "ok", "agent": "<name>", "service_account_id": SERVICE_ACCOUNT_ID}

    @app.post("/invoke")
    async def invoke(payload: dict) -> dict:
        ...

    if __name__ == "__main__":
        uvicorn.run(app, host="0.0.0.0", port=8100)
    ```

    ## REQUIRED: register with AgentScope Studio at startup.

    Call `agentscope.init()` once at module level so the agent appears in Studio
    and sends traces. Read STUDIO_URL from env (defaults to http://studio:3000):

    ```python
    import agentscope
    _STUDIO_URL = os.environ.get("STUDIO_URL", "http://studio:3000")
    agentscope.init(
        project=SERVICE_ACCOUNT_ID,
        name="{agent-name}",
        studio_url=_STUDIO_URL,
    )
    ```

    Place this BEFORE the agent setup block (after the identity asserts).

    For tools: use `from agentscope.tool import Toolkit`, create `toolkit = Toolkit()`,
    then call `toolkit.register_tool_function(fn)` for each callable from resolve_tools().

    ## REQUIRED: wrap tool functions so they return ToolResponse objects.

    AgentScope's Toolkit requires tool functions to return ToolResponse, not plain dicts.
    Wrap each tool before registering it:

    ```python
    import json as _json
    from agentscope.tool._toolkit import ToolResponse

    def _as_tool_response(fn):
        from functools import wraps
        @wraps(fn)
        def wrapper(*args, **kwargs):
            result = fn(*args, **kwargs)
            return ToolResponse(content=[{"type": "text", "text": _json.dumps(result, default=str)}])
        return wrapper

    toolkit = Toolkit()
    for fn in resolve_tools("banking-kyc", ["get_customer_profile", "get_kyc_documents", "get_external_screening"]):
        toolkit.register_tool_function(_as_tool_response(fn))
    ```

    ## REQUIRED: include "user" in generate_kwargs to satisfy LiteLLM enforce_user_param.

    The make_model function MUST include `"user": SERVICE_ACCOUNT_ID` at the top level
    of generate_kwargs (not inside extra_body):

    ```python
    generate_kwargs={
        "temperature": 1.0,
        "user": SERVICE_ACCOUNT_ID,
        "extra_body": {
            "reasoning_effort": reasoning_effort,
            "metadata": {"actor_type": "agent", "actor_id": SERVICE_ACCOUNT_ID},
        },
    }
    ```

    `ReActAgent.__call__` is async — the invoke endpoint must be `async def`.

    ## CRITICAL: Role/skill content must be loaded from a file, never embedded as a string literal.

    The role file is copied into the container at its original relative path.
    Always load it like this (substituting the actual agent_role_file path from the spec):

    ```python
    from pathlib import Path
    ROLE = Path("agent-roles/ats/kyc-refresh.role.md").read_text(encoding="utf-8")
    # For legacy specs that still use "skill:" field, substitute the skill path instead.
    ```

    DO NOT embed the skill text directly as a Python string. The skill content contains
    markdown code fences which will break any string literal.

    ## REQUIRED: free-text input adapter on every /invoke endpoint.

    The /invoke endpoint must accept BOTH structured JSON (workflow path) and
    free-text {"text": "..."} (chat/Test-panel path).  Use this pattern:

    ```python
    import json as _json

    AGENT_INPUT_SCHEMA = <paste the agent's input_schema dict here, or {} if none>

    def _looks_structured(payload: dict) -> bool:
        # True if payload has any required fields (structured path)
        required = AGENT_INPUT_SCHEMA.get("required", [])
        return bool(required and any(k in payload for k in required))

    async def _extract_input_from_text(text: str) -> dict:
        # Free-text to structured via Gemini Flash
        import httpx as _httpx
        resp = _httpx.post(
            f"{LITELLM_BASE_URL}/v1/chat/completions",
            headers={"Authorization": f"Bearer {LITELLM_API_KEY}"},
            json={
                "model": "gemini-3-flash",
                "messages": [
                    {"role": "system", "content": (
                        "Extract the structured input fields from the user message. "
                        "Return JSON matching this schema: "
                        + _json.dumps(AGENT_INPUT_SCHEMA)
                        + ". If a required field cannot be extracted, use null."
                    )},
                    {"role": "user", "content": text},
                ],
                "temperature": 1.0,
                "user": SERVICE_ACCOUNT_ID,
            },
            timeout=30,
        )
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"]
        try:
            return _json.loads(content)
        except Exception:
            import re as _re
            m = _re.search(r'\{.*\}', content, _re.DOTALL)
            return _json.loads(m.group()) if m else {}

    ## REQUIRED: clear agent memory and strip code fences before each invocation.

    AgentScope's InMemoryMemory accumulates history across HTTP requests in the same
    process. Clear it at the START of the flow function to prevent cross-customer
    contamination. Also, always strip markdown code fences from agent output before
    JSON-parsing (Gemini sometimes wraps output in ```json...```):

    ```python
    async def standalone_run(payload: dict) -> dict:
        await <agent_name>.memory.clear()   # InMemoryMemory.clear() is async — must await
        # Build user_input: prefer "text" (free-text path), then "input", else dump the whole dict.
        user_input = payload.get("text") or payload.get("input") or _json.dumps(payload, default=str)
        ...
        # After getting output_text from the agent response:
        try:
            _clean = output_text.strip()
            if _clean.startswith("```json"):
                _clean = _clean[7:]
            elif _clean.startswith("```"):
                _clean = _clean[3:]
            if _clean.endswith("```"):
                _clean = _clean[:-3]
            return json.loads(_clean.strip())
        except json.JSONDecodeError:
            import re as _re2
            m = _re2.search(r"\{.*\}", output_text, _re2.DOTALL)
            if m:
                try:
                    return json.loads(m.group())
                except Exception:
                    pass
            return {"raw_output": output_text, "confidence": 0.0,
                    "recommendation": "REVIEW",
                    "notes_for_reviewer": "Agent output was not valid JSON"}
    ```

    @app.post("/invoke")
    async def invoke(payload: dict) -> dict:
        run_id = payload.pop("_run_id", None)   # propagated from builder-backend for trace correlation
        if "file_base64" in payload or "file" in payload:
            # File/document path — pass directly; agent reads file_base64 + mime_type from payload
            structured = payload
        elif "text" in payload and not _looks_structured(payload):
            if AGENT_INPUT_SCHEMA:
                # Schema defined: extract structured fields from free text via Gemini Flash
                structured = await _extract_input_from_text(payload["text"])
            else:
                # No schema: agent accepts raw free text — pass it directly
                structured = {"text": payload["text"]}
        else:
            # Structured JSON path: workflow invocation or direct API call with known fields
            structured = payload
        result = await <flow_run_function>(structured)
        if run_id:
            result["_run_id"] = run_id
        return result
    ```

    ## REQUIRED: agentscope_skills integration.

    If the spec declares agentscope_skills (e.g. [web_search]), import from the
    agentscope_skills package and add to the toolkit alongside domain tools:

    ```python
    from agentscope_skills import web_search as _web_search_fn

    # ... after the toolkit is created and domain tools are registered:
    toolkit.register_tool_function(_as_tool_response(_web_search_fn))
    ```

    ## REQUIRED: guided-mode system prompt augmentation.

    If reasoning_mode is "guided", append a TOOL_CATALOG block to the sys_prompt:

    ```python
    TOOL_CATALOG = (
        "\\n\\nYou have these tools available. Choose which to call based on what "
        "you need to learn from the input. You don't have to call all of them.\\n\\n"
        "<list each tool name + its first docstring line>"
    )
    <agent_name>_sys_prompt = ROLE + TOOL_CATALOG
    ```

    For "prescribed" mode: sys_prompt = ROLE (no catalog block).

    ## TOOL-FREE AGENTS (tools: [] in spec)

    If the spec has an empty tools list, the agent does pure LLM reasoning with no
    external calls. DO NOT invent tool names. DO NOT import resolve_tools. DO NOT
    define _as_tool_response. Use a bare ReActAgent with no toolkit:

    ```python
    # No tools — pure reasoning agent
    <<agent_name>> = ReActAgent(
        name="<<agent.name>>",
        sys_prompt=<<agent_name>>_sys_prompt,
        model=make_model("<<agent.model>>", reasoning_effort="<<agent.reasoning_effort>>"),
        formatter=OpenAIChatFormatter(),
        memory=InMemoryMemory(),
        max_iters=<<agent.max_iterations>>,
    )
    ```

    The /invoke handler and standalone_run are identical — just no toolkit setup block.

    Output ONE fenced ```python``` block. Nothing before. Nothing after.
""")


def _load_skill_md() -> str:
    skill_path = SKILLS_PATH / "builder" / "SKILL.md"
    return skill_path.read_text(encoding="utf-8")


def _load_role_file(rel_path: str) -> str:
    """Load a role or legacy skill file relative to the project root."""
    for base in [Path("/app"), Path(".")]:
        p = base / rel_path
        if p.exists():
            return p.read_text(encoding="utf-8")
    return ""


def _extract_code_block(text: str) -> str:
    """
    Pull the first ```python ... ``` block from LLM output.
    Uses line-anchored matching so that triple-backticks inside string
    literals (e.g. '```json') don't terminate the block early.
    """
    # Find opening fence
    start_m = re.search(r"```python[ \t]*\n", text)
    if start_m:
        start = start_m.end()
        # Closing fence must be ``` at the start of a line
        end_m = re.search(r"^```[ \t]*$", text[start:], re.MULTILINE)
        if end_m:
            return text[start : start + end_m.start()].strip()
        return text[start:].strip()
    # Fallback: strip any leading/trailing fences
    return re.sub(r"^```\w*\s*|```\s*$", "", text, flags=re.MULTILINE).strip()


def _fix_inline_skill(code: str, spec: AgentSpec) -> str:
    """
    Replace any triple-quoted inline skill literal with Path().read_text().

    Gemini sometimes embeds the skill content as a string literal despite
    instructions. This post-processing step makes the fix deterministic.
    """
    skill_path = spec.spec.agents[0].effective_role_path()

    # Replace SKILL = """...""" or SKILL = '''...'''
    code = re.sub(
        r'(SKILL\s*=\s*)""".*?"""',
        f'\\1Path("{skill_path}").read_text(encoding="utf-8")',
        code,
        flags=re.DOTALL,
    )
    code = re.sub(
        r"(SKILL\s*=\s*)'''.*?'''",
        f'\\1Path("{skill_path}").read_text(encoding="utf-8")',
        code,
        flags=re.DOTALL,
    )

    # Ensure pathlib.Path is imported
    if "from pathlib import Path" not in code and "import pathlib" not in code:
        # Insert after the last stdlib import block
        code = "from pathlib import Path\n" + code

    return code


def _fix_generated_patterns(code: str) -> str:
    """
    Deterministic post-processing to correct patterns Gemini reliably gets wrong,
    regardless of template instructions.
    """
    # 1. InMemoryMemory.clear() is async — ensure it is always awaited.
    #    Add 'await' then collapse any accidental double-await.
    code = re.sub(r'(\w+\.memory\.clear\(\))', r'await \1', code)
    code = re.sub(r'\bawait\s+await\b', 'await', code)

    # 2. user_input inside standalone_run: handle text / structured / binary.
    #    Gemini generates payload.get("input", payload) which passes a dict literal
    #    when neither "input" nor "text" is present, causing the agent to process
    #    the stringified dict instead of real content.
    code = re.sub(
        r'user_input\s*=\s*payload\.get\(["\']input["\'],\s*payload\)',
        'user_input = payload.get("text") or payload.get("input") or _json.dumps(payload, default=str)',
        code,
    )

    # 3. /invoke routing block: rewrite deterministically to guarantee all three paths
    #    (file/binary, free-text, structured) regardless of what Gemini generated.
    #    Matches any variant of the text-routing block and replaces it wholesale.
    _ROUTING_RE = re.compile(
        r'(?P<ind>[ \t]+)if ["\']text["\'] in payload.*?'
        r'(?P=ind)else:\n(?P=ind)[ \t]+structured\s*=\s*payload',
        re.DOTALL,
    )

    def _routing_replacement(m: re.Match) -> str:
        ind = m.group('ind')
        return (
            f'{ind}if "file_base64" in payload or "file" in payload:\n'
            f'{ind}    structured = payload\n'
            f'{ind}elif "text" in payload and not _looks_structured(payload):\n'
            f'{ind}    if AGENT_INPUT_SCHEMA:\n'
            f'{ind}        structured = await _extract_input_from_text(payload["text"])\n'
            f'{ind}    else:\n'
            f'{ind}        structured = {{"text": payload["text"]}}\n'
            f'{ind}else:\n'
            f'{ind}    structured = payload'
        )

    code = _ROUTING_RE.sub(_routing_replacement, code)

    # 4. Deterministically inject ReMe env-var reads and memory helper functions.
    #    Guards are idempotent — injection is skipped if already present.
    #    Functions are no-ops when AGENT_MEMORY_KIND env var is empty.
    if '_MEM_KIND' not in code:
        _REME_BLOCK = textwrap.dedent("""\

            # ── ReMe cross-conversation memory ─────────────────────────────────
            REME_URL = os.environ.get("REME_URL", "http://reme:8002")
            _MEM_KIND = os.environ.get("AGENT_MEMORY_KIND", "")
            _MEM_IDENTITY_FIELD = os.environ.get("AGENT_MEMORY_IDENTITY_FIELD", "")
            _MEM_TASK_KEY = os.environ.get("AGENT_MEMORY_TASK_KEY", "")
            try:
                from memory.reme_client import ReMeClient as _ReMeClient
                _reme = _ReMeClient(base_url=REME_URL, actor_id=SERVICE_ACCOUNT_ID)
            except Exception:
                _reme = None

            async def hydrate_memory(input_data: dict) -> str:
                if not _MEM_KIND or _reme is None:
                    return ""
                query = str(input_data)[:300]
                if _MEM_KIND == "personal":
                    identity = str(input_data.get(_MEM_IDENTITY_FIELD, "")) if _MEM_IDENTITY_FIELD else ""
                    if not identity:
                        return ""
                    mems = await _reme.retrieve_personal(user_id=identity, query=query)
                else:
                    mems = await _reme.retrieve_task(task_key=_MEM_TASK_KEY, query=query)
                if not mems:
                    return ""
                return "\\n\\n# Relevant prior context:\\n" + "\\n".join(
                    f"- {m.get('content', m.get('summary', ''))}" for m in mems[:5]
                )

            async def persist_memory(input_data: dict, output_text: str) -> None:
                if not _MEM_KIND or _reme is None:
                    return
                content = f"Input: {str(input_data)[:200]} -> Output: {output_text[:400]}"
                if _MEM_KIND == "personal":
                    identity = str(input_data.get(_MEM_IDENTITY_FIELD, "")) if _MEM_IDENTITY_FIELD else ""
                    if identity:
                        await _reme.write_personal(user_id=identity, content=content)
                else:
                    await _reme.write_task(task_key=_MEM_TASK_KEY, content=content)

        """)
        # Insert before the standalone_run / flow function definition
        for marker in ('async def standalone_run(', 'async def maker_checker_run('):
            if marker in code:
                code = code.replace(marker, _REME_BLOCK + marker, 1)
                break

    # 5. Wrap the flow-function call in standalone_run with memory hydrate/persist.
    #    Pattern: `    result = await <fn_name>(structured)` inside the /invoke handler.
    #    Only wraps if hydrate_memory is present and not already wrapped.
    if 'hydrate_memory' in code and 'await hydrate_memory' not in code:
        _FLOW_CALL_RE = re.compile(
            r'(?P<ind>[ \t]+)(?P<stmt>result\s*=\s*await\s+\w+\(structured\))'
        )

        def _flow_call_wrap(m: re.Match) -> str:
            ind = m.group('ind')
            return (
                f'{ind}_mem_ctx = await hydrate_memory(structured)\n'
                f'{ind}if _mem_ctx:\n'
                f'{ind}    structured["_memory_context"] = _mem_ctx\n'
                f'{ind}{m.group("stmt")}\n'
                f'{ind}await persist_memory(structured, str(result))'
            )

        code = _FLOW_CALL_RE.sub(_flow_call_wrap, code)

    return code


def _lint(code: str, spec: AgentSpec | None = None) -> list[str]:
    errors = []
    has_tools = bool(spec and any(ag.tools for ag in spec.spec.agents)) if spec else True

    for pattern, msg in _REQUIRED_PATTERNS:
        # Skip tool-related checks for tool-free agents — no hallucination forced.
        if not has_tools and pattern in (
            r"from tools\.registry import resolve_tools",
            r'_as_tool_response|ToolResponse',
        ):
            continue
        if not re.search(pattern, code):
            errors.append(f"MISSING: {msg}")

    for pattern, msg in _FORBIDDEN_PATTERNS:
        if re.search(pattern, code):
            errors.append(f"FORBIDDEN: {msg}")
    return errors


def compile_agent(name: str, spec: AgentSpec, spec_dict: dict) -> str:
    """
    Generate agent.py from spec using Gemini via LiteLLM.
    Returns the validated Python source code.
    Raises ValueError if both attempts fail lint/parse.
    """
    spec_yaml = yaml.dump(spec_dict, sort_keys=False, allow_unicode=True)
    system_prompt = _load_skill_md() + "\n\n" + _FASTAPI_OVERRIDE

    # Collect role files (new canonical) or legacy skill files
    skill_blocks = []
    for ag in spec.spec.agents:
        role_path = ag.effective_role_path()
        content = _load_role_file(role_path) if role_path else ""
        if content:
            skill_blocks.append(f"## Role / Skill: {ag.name}\n\n{content}")

    user_message = (
        f"Generate agent.py for this spec:\n\n```yaml\n{spec_yaml}\n```\n\n"
        + ("\n\n".join(skill_blocks) if skill_blocks else "")
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_message},
    ]
    broken_code: str | None = None

    for attempt in range(2):
        if attempt == 1 and broken_code:
            # Second pass: targeted fix — pass broken code back with error description
            lint_errors = _lint(broken_code, spec)
            feedback = "Your previous output had issues. Fix ONLY the problems below, keep everything else identical:\n"
            try:
                ast.parse(broken_code)
            except SyntaxError as se:
                lines = broken_code.splitlines()
                ctx = "\n".join(
                    f"  line {i+1}: {lines[i]}"
                    for i in range(max(0, se.lineno - 3), min(len(lines), se.lineno + 1))
                )
                feedback += f"\n- SyntaxError at line {se.lineno}: {se.msg}\n  Context:\n{ctx}"
                feedback += "\n  TIP: string literals must not span multiple lines unless triple-quoted. Use `str(...)` or escape backslashes."
            if lint_errors:
                feedback += "\n" + "\n".join(f"- {e}" for e in lint_errors)
            feedback += "\n\nOutput the corrected ```python``` block and nothing else."
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
                {"role": "assistant", "content": f"```python\n{broken_code}\n```"},
                {"role": "user", "content": feedback},
            ]

        raw = chat_completion(
            messages=messages,
            model="gemini-3.1-pro",
            reasoning_effort="medium" if attempt == 0 else "high",
        )
        code = _extract_code_block(raw)
        code = _fix_inline_skill(code, spec)
        code = _fix_generated_patterns(code)

        # Syntax check
        try:
            ast.parse(code)
        except SyntaxError as e:
            broken_code = code
            if attempt == 0:
                continue
            raise ValueError(f"Generated code has syntax error: {e}") from e

        # Lint check — pass spec so tool-related rules skip for tool-free agents
        errors = _lint(code, spec)
        if errors:
            broken_code = code
            if attempt == 0:
                continue
            raise ValueError(f"Generated code failed lint after 2 attempts:\n" + "\n".join(errors))

        return code

    raise ValueError("Code generation failed after 2 attempts")


def code_hash(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()[:16]


# ---------------------------------------------------------------------------
# Spec generation (NL prose → agent-spec YAML)
# ---------------------------------------------------------------------------

_SPEC_GEN_SYSTEM = textwrap.dedent("""
    You convert natural-language descriptions into Atom agent-spec YAML.

    The output MUST be a single ```yaml``` fenced block matching this schema exactly:

    ```yaml
    apiVersion: atom.platform/v1
    kind: AgentDeployment
    metadata:
      name: <kebab-case-name>
      domain: <domain-name>
      version: 1.0.0
      description: <one sentence>
      owner: user:default@atom.io
    spec:
      agents:
        - name: <agent-name>
          role: standalone
          agent_role_file: agent-roles/<domain>/<name>.role.md
          reasoning_mode: prescribed
          model: gemini-3.1-pro
          temperature: 1.0
          reasoning_effort: medium
          max_iterations: 6
          tools:
            - <tool1>
            - <tool2>
          memory:
            type: short_term
            cross_conversation:
              enabled: true
              kind: personal
              identity_field: input.customer_id
      flow:
        type: standalone
      audit:
        log_to: minio://audit-logs/agent/<name>
        retention_days: 90
      deployment:
        runtime: agentscope
        sandbox: base
        replicas: 1
    ```

    The spec MUST also include an `input_schema` field under each agent that describes
    what the /invoke endpoint accepts. Choose the right schema based on what the agent
    processes:

    ```yaml
          # For agents that work with structured domain entities:
          input_schema:
            type: object
            properties:
              customer_id: {type: string, description: Customer identifier}
              transfer_id: {type: string, description: Transfer request ID}
            required: [customer_id]

          # For agents that process uploaded documents or images (OCR, claims scanning):
          input_schema:
            type: object
            properties:
              file_base64: {type: string, description: Base64-encoded file content}
              mime_type:
                type: string
                enum: [application/pdf, image/jpeg, image/png, text/plain]
                description: MIME type of the uploaded file
            required: [file_base64, mime_type]

          # For agents that accept raw free text with no fixed structure:
          input_schema: {}
    ```

    Tools are domain-specific — only add tools when the agent MUST call external services.
    If the user says "no tools", "pure reasoning", "no external calls", or similar →
    set tools to an empty list []. DO NOT invent tool names to fill the field.

    ```yaml
          tools: []   # tool-free agent — valid, no hallucination
    ```

    Input schema inference rules (apply in order):
    1. If the description mentions documents, files, PDF, images, OCR, or scans → use the file_base64 schema.
    2. If the domain processes structured entities → add required fields that identify those entities.
    3. If the domain processes documents/files → use the file_base64 schema.
    4. If the agent processes free text → use `input_schema: {}`
    5. memory.identity_field must reference a field that exists in input_schema (e.g. input.customer_id).
       If the schema has no customer identifier, set cross_conversation.enabled to false.

    Rules:
    - temperature MUST be 1.0
    - Only use tools that exist for the chosen domain — never guess tool names
    - If no tools are needed, tools: [] is correct and complete
    - Output ONE ```yaml``` block. Nothing else.
""")


_SKILL_GEN_SYSTEM = textwrap.dedent("""
    You write domain-specific skill files for Atom Platform agents.
    A skill file is the system prompt the agent uses at runtime.

    Study the following two reference skills carefully — yours must match this quality:

    === REFERENCE 1: Document Processing Agent ===
    You are an agent in a document processing workflow. You are invoked when a
    document arrives and needs to be classified before it can proceed.
    Your output is consumed by the workflow engine.

    Process: 1. Decode file_base64 content. 2. Identify document type. 3. Extract
    key fields. 4. Compute confidence score based on extraction completeness.

    Output: valid JSON with document_type, extracted_fields, confidence,
    recommendation (PASS|REVIEW|ESCALATE), notes_for_reviewer.
    No markdown fences. No prose before or after the JSON.

    Critical rules: confidence <0.85 → recommendation REVIEW or ESCALATE.

    === REFERENCE 2: Data Reconciliation Agent ===
    You compare incoming data records against master records to identify discrepancies.
    Process: 1. Fetch source records. 2. Fetch master records. 3. Compare fields.
    4. Classify each record: match | field_mismatch | missing_record | extra_record.
    Output: JSON with records_count, reconciled[], issues[], confidence,
    recommendation (PASS|REVIEW), notes_for_reviewer.
    Confidence <0.80 → REVIEW. Missing master record → cannot PASS.

    === YOUR TASK ===
    Given the agent's name, domain, description, tools, and expected I/O,
    write a complete skill file in the same format.

    The output MUST be a single ```markdown``` fenced block containing the skill file.
    The skill file structure:

    ```markdown
    ---
    name: <kebab-case-name>
    description: |
      One or two sentence summary.
    trigger: |
      Short phrase 1
      Short phrase 2
    ---

    # <Agent Title>

    [One paragraph: who you are, what workflow you're part of, your constraints]

    ## Your role and boundaries

    [2–4 bullet points defining inform/recommend/not-authorize, what data you use, when to escalate]

    ## Input format

    [Describe what fields the agent expects in its invocation payload.
     For structured agents: list each required field and its type.
     For file agents: "Receives file_base64 (base64-encoded content) and mime_type. Decode to read."
     For free-text agents: "Receives a text field containing the raw user input."]

    ## Process

    [Numbered steps. Each step specifies exactly which tool to call and why.
    If no external tools: describe the reasoning process step by step.]

    ## Output format (must be valid JSON)

    ```json
    {
      // All output fields with types and descriptions
    }
    ```

    ## Critical rules

    [4–8 specific, testable rules. E.g. "confidence <X → recommendation must be Y"]

    ## What you must NOT do

    [3–5 prohibitions that prevent common failure modes]

    ## Verification before responding

    - [ ] Did I complete all steps?
    - [ ] Is my confidence consistent with findings?
    - [ ] Output is single valid JSON, no markdown wrapping?

    If any answer is no, redo.
    ```

    Output ONE ```markdown``` block. Nothing before. Nothing after.
""")


def generate_skill(prose: str, spec_dict: dict) -> str:
    """
    Generate a domain-specific skill file for the agent described in spec_dict.
    Returns the skill file content as a string (markdown).
    """
    agents = spec_dict.get("spec", {}).get("agents", [{}])
    ag = agents[0] if agents else {}
    meta = spec_dict.get("metadata", {})

    input_schema = ag.get("input_schema") or {}
    schema_desc = (
        "file_base64 + mime_type (document/image upload)"
        if "file_base64" in (input_schema.get("properties") or {})
        else (", ".join(input_schema.get("required", [])) or "free text (no fixed schema)")
    )

    context = (
        f"Agent name: {meta.get('name')}\n"
        f"Domain: {meta.get('domain')}\n"
        f"Description: {meta.get('description')}\n"
        f"Tools available: {', '.join(ag.get('tools', [])) or 'none (reasoning-only)'}\n"
        f"Role: {ag.get('role', 'standalone')}\n"
        f"Input schema: {schema_desc}\n"
        f"Full input_schema: {input_schema}\n"
        f"Original request: {prose}\n\n"
        "Write a complete, actionable skill file for this agent. "
        "The ## Input format section must match the input_schema exactly. "
        "Include a specific JSON output format with all fields named and typed. "
        "Make the process steps concrete — what does the agent check and in what order. "
        "Make the critical rules specific and testable."
    )

    raw = chat_completion(
        messages=[
            {"role": "system", "content": _SKILL_GEN_SYSTEM},
            {"role": "user", "content": context},
        ],
        model="gemini-3.1-pro",
        reasoning_effort="medium",
    )

    # Extract the markdown block
    m = re.search(r"```markdown\s*(.*?)```", raw, re.DOTALL)
    if m:
        return m.group(1).strip()
    # Fallback: strip any outer fences
    return re.sub(r"^```\w*\s*|```\s*$", "", raw, flags=re.MULTILINE).strip()


def generate_spec(prose: str) -> dict:
    """
    Generate an agent spec dict from a natural-language prose description.
    Returns the parsed spec dict (not yet validated against AgentSpec schema).
    """
    raw = chat_completion(
        messages=[
            {"role": "system", "content": _SPEC_GEN_SYSTEM},
            {"role": "user", "content": prose},
        ],
        model="gemini-3.1-pro",
        reasoning_effort="low",
    )
    m = re.search(r"```yaml\s*(.*?)```", raw, re.DOTALL)
    yaml_text = m.group(1).strip() if m else raw.strip()
    return yaml.safe_load(yaml_text)
