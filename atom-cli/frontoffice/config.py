"""
Agent configuration.

ATOM_MODE=dev  → calls LLM provider directly using your API key.
                 No GATE, no domain, no agent token needed.

ATOM_MODE=prod → routes all LLM calls through GATE using AtomChatWrapper.
                 Requires: domain + agent provisioned in atom-studio,
                           ATOM_AGENT_JWT set to your agent token.
"""
import os

MODE = os.getenv("ATOM_MODE", "dev")


def get_model_config() -> dict:
    if MODE == "prod":
        # In prod, AtomChatWrapper reads ATOM_GATE_URL and ATOM_AGENT_JWT from env.
        # The model_name here is the virtual model alias registered in atom-llm.
        return {
            "model_type": "atom",          # AtomChatWrapper
            "config_name": "atom-default",
            "model_name": os.environ["ATOM_MODEL_NAME"],
        }
    else:
        # In dev, call the provider directly via OpenAI-compatible API.
        return {
            "model_type": "openai_chat",   # OpenAIChatWrapper (works for any OpenAI-compat endpoint)
            "config_name": "dev-model",
            "model_name": os.environ["MODEL_NAME"],
            "api_key": os.environ["LLM_API_KEY"],
            "client_args": {
                "base_url": os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1"),
            },
        }
