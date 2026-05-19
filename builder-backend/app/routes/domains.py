"""Domain/subdomain taxonomy API.

GET /domains          — list all known domain+subdomain pairs from agents+tools
GET /domains/suggest  — autocomplete for domain/subdomain inputs
"""

from fastapi import APIRouter, Query
from app.core import registry_db

router = APIRouter(prefix="/domains", tags=["domains"])

# Curated default taxonomy shown even before agents/tools are deployed.
# Augmented at runtime with whatever's actually stored in the DB.
_DEFAULT_TAXONOMY = [
    {"domain": "banking",   "subdomains": ["fraud", "kyc", "securities", "treasury"]},
    {"domain": "general",   "subdomains": ["qa", "risk"]},
    {"domain": "insurance", "subdomains": ["claims", "ocr"]},
    {"domain": "payments",  "subdomains": ["compliance", "risk"]},
]


@router.get("")
def list_domains():
    """Return all known domain/subdomain pairs (defaults + live DB data merged)."""
    db_taxonomy = {t["domain"]: set(t["subdomains"]) for t in registry_db.get_domain_taxonomy()}

    # Merge defaults with DB data
    result_map: dict[str, set] = {}
    for entry in _DEFAULT_TAXONOMY:
        result_map[entry["domain"]] = set(entry["subdomains"])

    for domain, subdomains in db_taxonomy.items():
        if domain in result_map:
            result_map[domain].update(subdomains)
        else:
            result_map[domain] = subdomains

    return {
        "domains": [
            {"domain": d, "subdomains": sorted(list(sds))}
            for d, sds in sorted(result_map.items())
        ]
    }


@router.get("/suggest")
def suggest(q: str = Query("", description="Partial domain or subdomain string")):
    """Autocomplete — returns matching domain+subdomain pairs."""
    all_domains = list_domains()["domains"]
    q = q.lower().strip()
    if not q:
        return {"suggestions": all_domains}

    matches = []
    for entry in all_domains:
        if q in entry["domain"]:
            matches.append(entry)
        else:
            matching_subs = [s for s in entry["subdomains"] if q in s]
            if matching_subs:
                matches.append({"domain": entry["domain"], "subdomains": matching_subs})
    return {"suggestions": matches}
