import httpx

from ..config import get_settings
from ..database import get_conn


async def create_domain(name: str, description: str | None, owner_id: str) -> dict:
    settings = get_settings()

    async with get_conn() as conn:
        async with conn.transaction():
            domain = await conn.fetchrow(
                """
                INSERT INTO domains (name, description, owner_id)
                VALUES ($1, $2, $3)
                RETURNING id, name, description, owner_id, is_active, created_at
                """,
                name,
                description,
                owner_id,
            )

            try:
                async with httpx.AsyncClient(timeout=15) as client:
                    resp = await client.post(
                        f"{settings.atom_llm_url}/atom/provision_domain",
                        json={"domain_id": str(domain["id"]), "domain_name": name},
                    )
                    resp.raise_for_status()
                    litellm_data = resp.json()
            except Exception as e:
                raise RuntimeError(f"LiteLLM team provisioning failed: {e}")

            await conn.execute(
                "UPDATE domains SET litellm_team_id = $1 WHERE id = $2",
                litellm_data["team_id"],
                domain["id"],
            )

    return {**dict(domain), "litellm_team_id": litellm_data["team_id"]}


async def list_domains(include_inactive: bool = False) -> list[dict]:
    async with get_conn() as conn:
        where = "" if include_inactive else "WHERE d.is_active = true"
        rows = await conn.fetch(
            f"""
            SELECT d.id, d.name, d.description, d.owner_id, d.is_active,
                   d.litellm_team_id, d.created_at,
                   count(a.id) FILTER (WHERE a.status != 'suspended') as agent_count
            FROM domains d
            LEFT JOIN agents a ON a.domain_id = d.id
            {where}
            GROUP BY d.id
            ORDER BY d.created_at DESC
            """
        )
    return [dict(r) for r in rows]


async def get_domain(domain_id: str) -> dict | None:
    async with get_conn() as conn:
        row = await conn.fetchrow(
            """
            SELECT d.id, d.name, d.description, d.owner_id, d.is_active,
                   d.litellm_team_id, d.created_at,
                   count(a.id) FILTER (WHERE a.status != 'suspended') as agent_count
            FROM domains d
            LEFT JOIN agents a ON a.domain_id = d.id
            WHERE d.id = $1
            GROUP BY d.id
            """,
            domain_id,
        )
    return dict(row) if row else None


async def update_domain(domain_id: str, name: str | None, description: str | None) -> dict | None:
    async with get_conn() as conn:
        row = await conn.fetchrow(
            """
            UPDATE domains
            SET name        = COALESCE($1, name),
                description = COALESCE($2, description)
            WHERE id = $3
            RETURNING id, name, description, owner_id, is_active, litellm_team_id, created_at
            """,
            name,
            description,
            domain_id,
        )
    return dict(row) if row else None


async def delete_domain(domain_id: str) -> bool:
    settings = get_settings()

    async with get_conn() as conn:
        row = await conn.fetchrow(
            "SELECT litellm_team_id FROM domains WHERE id = $1 AND is_active = true",
            domain_id,
        )
    if not row:
        return False

    async with get_conn() as conn:
        await conn.execute(
            "UPDATE domains SET is_active = false WHERE id = $1",
            domain_id,
        )

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.request(
                "DELETE",
                f"{settings.atom_llm_url}/atom/deprovision_domain",
                json={"litellm_id": row["litellm_team_id"] or domain_id},
            )
            resp.raise_for_status()
    except Exception:
        pass

    return True
