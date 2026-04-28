"""
atom_extensions/apply_patches.py

Applies the three ATOM-specific changes to the installed litellm proxy_server.py.
Run once at Docker build time from Dockerfile.dev.

Patches (see UPSTREAM_DIFF.md):
  1. user_telemetry = False       — disable phone-home
  2. X-ATOM-Agent-ID injection    — forward agent identity to atom-llm metadata
  3. atom_extensions router reg   — register /atom/provision_agent, /atom/tools etc.
"""

import os

import litellm

PROXY_SERVER = os.path.join(os.path.dirname(litellm.__file__), "proxy", "proxy_server.py")

print(f"Patching: {PROXY_SERVER}")  # noqa: T201

with open(PROXY_SERVER, encoding="utf-8") as f:
    src = f.read()

original = src

# ── Patch 1: disable telemetry ────────────────────────────────────────────────
if "user_telemetry = True" in src:
    src = src.replace(
        "user_telemetry = True",
        "user_telemetry = False  # ATOM: phone-home disabled",
        1,
    )
    print("  ✓ Patch 1: user_telemetry = False")  # noqa: T201
elif "user_telemetry = False  # ATOM" in src:
    print("  ✓ Patch 1: already applied")  # noqa: T201
else:
    print("  ⚠ Patch 1: user_telemetry not found — version may have changed")  # noqa: T201

# ── Patch 2: inject X-ATOM-Agent-ID into metadata ─────────────────────────────
ATOM_AGENT_ID_MARKER = "atom_agent_id = request.headers.get"
if ATOM_AGENT_ID_MARKER not in src:
    ANCHOR = 'data["metadata"]["agent_id"] = user_api_key_dict.agent_id'
    INJECT = (
        "\n\n        # ATOM: propagate GATE-injected agent identity into LLM metadata\n"
        '        atom_agent_id = request.headers.get("X-ATOM-Agent-ID")\n'
        "        if atom_agent_id:\n"
        '            data["metadata"]["atom_agent_id"] = atom_agent_id'
    )
    if ANCHOR in src:
        src = src.replace(ANCHOR, ANCHOR + INJECT, 1)
        print("  ✓ Patch 2: X-ATOM-Agent-ID injection added")  # noqa: T201
    else:
        print("  ⚠ Patch 2: anchor not found — skipping")  # noqa: T201
else:
    print("  ✓ Patch 2: already applied")  # noqa: T201

# ── Patch 3: register atom_extensions routers ────────────────────────────────
ATOM_ROUTER_MARKER = "atom_extensions.provision"
if ATOM_ROUTER_MARKER not in src:
    ROUTER_BLOCK = """

# ATOM extensions — registered last so they can import from proxy internals
try:
    from atom_extensions.provision import atom_router as atom_provision_router
    from atom_extensions.tools_skills import atom_tools_router
    app.include_router(atom_provision_router)
    app.include_router(atom_tools_router)
except ImportError:
    pass  # atom_extensions not present in this environment"""

    for anchor in ("app.include_router(anthropic_skills_router)", "app.include_router(anthropic_router)"):
        if anchor in src:
            src = src.replace(anchor, anchor + ROUTER_BLOCK, 1)
            print(f"  ✓ Patch 3: atom_extensions routers registered (anchor: {anchor})")  # noqa: T201
            break
    else:
        print("  ⚠ Patch 3: anchor not found — routes not registered")  # noqa: T201
else:
    print("  ✓ Patch 3: already applied")  # noqa: T201

# ── Write back ────────────────────────────────────────────────────────────────
if src != original:
    with open(PROXY_SERVER, "w", encoding="utf-8") as f:
        f.write(src)
    print(f"\nPatches written to {PROXY_SERVER}")  # noqa: T201
else:
    print("\nNo changes needed — all patches already applied")  # noqa: T201
