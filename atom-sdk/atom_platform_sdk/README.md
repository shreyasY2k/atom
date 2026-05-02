# atom-platform-sdk

Python SDK for building AI agents on the ATOM governance platform.

Provides `AtomChatModel`, HITL hooks, and `Toolkit` extensions on top of
the AgentScope framework. All LLM calls are routed through GATE —
authenticated, rate-limited, and immutably audit-logged.

## Install

```bash
pip install "git+https://github.com/shreyasY2k/atom.git#subdirectory=atom-sdk/atom_platform_sdk"
```

## Usage

```python
from agentscope.model import AtomChatModel

model = AtomChatModel(model_name="gemini-2.5-flash")
```

Full documentation: [docs/DEVELOPER_GUIDE.md](../../docs/DEVELOPER_GUIDE.md)
