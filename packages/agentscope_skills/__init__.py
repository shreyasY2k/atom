"""
agentscope_skills — upstream capability layer for Atom Agent Platform.

Provides reusable callable tools that agents can declare in their spec under
agentscope_skills: [web_search, ...].  These are generic capabilities that
complement domain-specific tools registered in tools/registry.py.

Hosted in this repo until the upstream agentscope-ai/agentscope-skills
package is published.  Pin the SHA in requirements.txt when that happens.
"""

from __future__ import annotations

import httpx


def web_search(query: str, max_results: int = 3) -> str:
    """Search the web for publicly available information about a topic.

    Use this to look up unfamiliar merchant names, company details, news about
    a counterparty, or any information not available in internal systems.

    Args:
        query: The search query, e.g. "Shell Oil Company merchant type".
        max_results: Maximum number of result snippets to return (default 3).

    Returns:
        Formatted string with search results, or an error message if unavailable.
    """
    try:
        r = httpx.get(
            "https://api.duckduckgo.com/",
            params={
                "q": query,
                "format": "json",
                "no_html": 1,
                "skip_disambig": 1,
                "t": "atom",
            },
            timeout=10,
            follow_redirects=True,
        )
        r.raise_for_status()
        data = r.json()

        results: list[str] = []

        abstract = data.get("AbstractText", "").strip()
        if abstract:
            source = data.get("AbstractSource", "")
            results.append(f"[{source}] {abstract}" if source else abstract)

        for topic in data.get("RelatedTopics", [])[:max_results]:
            if isinstance(topic, dict):
                text = topic.get("Text", "").strip()
                if text:
                    results.append(f"• {text}")

        if not results:
            return f"No results found for query: {query!r}"

        return f"Web search results for {query!r}:\n" + "\n".join(results[:max_results + 1])

    except httpx.TimeoutException:
        return f"Web search timed out for query: {query!r}"
    except Exception as exc:
        return f"Web search unavailable: {exc}"


__all__ = ["web_search"]
