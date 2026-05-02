# atom-platform-sdk

Python SDK for building AI agents on the ATOM governance platform.

Thin wrapper over the ATOM agentscope fork — provides `AtomChatModel`,
HITL hooks, and `Toolkit` extensions. All LLM calls route through GATE:
authenticated, rate-limited, and immutably audit-logged.

## Install

```bash
pip install "agentscope @ git+https://github.com/shreyasY2k/atom-sdk.git"
```

## Quick start

```python
import agentscope
from agentscope.model import AtomChatModel
from agentscope.agent import ReActAgent

agentscope.init(model_configs=[{
    "config_name": "atom",
    "model_type": "openai_chat",
    "model_name": "gemini-2.5-flash",          # must be in agent's allowed_models
    "api_key": "<ATOM_AGENT_JWT>",
    "client_args": {
        "base_url": "http://localhost:8080/domain/<domain-id>/agent/<agent-id>/v1/"
    },
}])

agent = ReActAgent(name="my-agent", model_config_name="atom")
```

Or use `init_atom()` for a simpler setup from environment variables:

```python
from atom_platform_sdk import init_atom

init_atom()   # reads ATOM_GATE_URL, ATOM_AGENT_JWT, ATOM_DOMAIN_ID, ATOM_AGENT_ID from .env
```

## Source

This SDK lives inside the [ATOM monorepo](https://github.com/shreyasY2k/atom)
under `atom-sdk/` and is published here as a public subtree for pip installs.

Full documentation: [docs/DEVELOPER_GUIDE.md](https://github.com/shreyasY2k/atom/blob/main/docs/DEVELOPER_GUIDE.md)
