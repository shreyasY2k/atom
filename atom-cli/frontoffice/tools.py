"""
Tool implementations for frontoffice.

Uses atom-sdk's agentscope.tool API:
  - Toolkit                  (replaces ServiceToolkit)
  - ToolResponse + TextBlock (replaces ServiceResponse / ServiceExecStatus)
"""
import urllib.request

from agentscope.message import TextBlock
from agentscope.tool import Toolkit, ToolResponse


def web_search(query: str) -> ToolResponse:
    """Search the web for information about the given query."""
    # TODO: replace stub with a real search API (e.g. Brave, Serper, Tavily)
    print(f"[web_search] query: {query}")
    return ToolResponse(
        content=[TextBlock(type="text", text=f"Stub result for: {query}. Replace with a real search implementation.")],
    )


def http_get(url: str) -> ToolResponse:
    """Make an HTTP GET request and return the response body."""
    try:
        with urllib.request.urlopen(url) as resp:  # noqa: S310
            return ToolResponse(content=[TextBlock(type="text", text=resp.read().decode())])
    except Exception as e:
        return ToolResponse(content=[TextBlock(type="text", text=f"Error: {e}")])


def memory_recall(query: str) -> ToolResponse:
    """Recall facts from agent memory."""
    print(f"[memory_recall] query: {query}")
    return ToolResponse(
        content=[TextBlock(type="text", text=f"Stub memory recall for: {query}.")],
    )


def build_toolkit() -> Toolkit:
    toolkit = Toolkit()
    toolkit.register_tool_function(web_search)
    toolkit.register_tool_function(http_get)
    toolkit.register_tool_function(memory_recall)
    return toolkit
