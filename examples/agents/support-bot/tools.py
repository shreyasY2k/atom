"""
Tool implementations — uses atom-sdk Toolkit/ToolResponse/TextBlock API.
"""
import urllib.request

from agentscope.message import TextBlock
from agentscope.tool import Toolkit, ToolResponse


def web_search(query: str) -> ToolResponse:
    """Search the web for information about the given query."""
    # Replace with a real search API (Brave, Serper, Tavily) in production
    return ToolResponse(
        content=[TextBlock(type="text", text=f"Stub result for: {query}. Replace with real search.")],
    )


def http_get(url: str) -> ToolResponse:
    """Make an HTTP GET request and return the response body."""
    try:
        with urllib.request.urlopen(url) as resp:  # noqa: S310
            return ToolResponse(content=[TextBlock(type="text", text=resp.read().decode()[:2000])])
    except Exception as e:
        return ToolResponse(content=[TextBlock(type="text", text=f"Error: {e}")])


def build_toolkit() -> Toolkit:
    toolkit = Toolkit()
    toolkit.register_tool_function(web_search)
    toolkit.register_tool_function(http_get)
    return toolkit
