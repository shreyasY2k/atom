# atom-sdk

ATOM's agentscope fork — adds `AtomChatModel`, HITL hooks, and `Toolkit`
extensions for the [ATOM AI Governance Platform](https://github.com/shreyasY2k/atom).

All LLM calls route through **GATE**: JWT-authenticated, OPA policy-checked,
rate-limited, and immutably audit-logged.

---

## Install

```bash
pip install "agentscope @ git+https://github.com/shreyasY2k/atom-sdk.git"
```

Requires Python 3.11+. `git` must be installed (`brew install git` / `apt install git`).

---

## Usage

```python
import agentscope
from agentscope.model import AtomChatModel
from agentscope.agent import ReActAgent
from agentscope.message import Msg

agentscope.init(model_configs=[{
    "config_name": "atom",
    "model_type": "openai_chat",
    "model_name": "gemini-2.5-flash",
    "api_key": "<ATOM_AGENT_JWT>",
    "client_args": {
        "base_url": "http://localhost:8080/domain/<domain-id>/agent/<agent-id>/v1/"
    },
}])

agent = ReActAgent(name="my-agent", model_config_name="atom")
response = agent(Msg(name="user", content="Hello!", role="user"))
print(response.content)
```

Or scaffold a full agent project with the CLI:

```bash
# Install CLI
curl -fsSL https://github.com/shreyasY2k/atom/releases/latest/download/atom_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/') \
  -o /usr/local/bin/atom && chmod +x /usr/local/bin/atom

atom create   # interactive wizard — scaffolds project + installs this SDK automatically
```

---

## What's in this fork

| Addition | Location |
|---|---|
| `AtomChatModel` | `src/agentscope/model/_atom_model.py` |
| HITL hooks | `src/agentscope/hooks/_studio_hooks.py` |
| `Toolkit` extensions | `src/agentscope/tool/_toolkit.py` |
| `atom_platform_sdk` wrapper | `atom_platform_sdk/` |

---

## Source

This repo is a public subtree of the
[ATOM monorepo](https://github.com/shreyasY2k/atom) (`atom-sdk/` prefix).
Changes are authored there and synced here with:

```bash
git subtree push --prefix=atom-sdk atom-sdk-public main
```
