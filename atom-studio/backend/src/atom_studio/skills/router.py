import logging
import os

import yaml
from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel

from ..auth.middleware import require_auth
from ..database import get_conn

logger = logging.getLogger(__name__)
router = APIRouter()

SKILLS_DIR = os.environ.get("ATOM_SKILLS_DIR", "/atom-sdk/skills")


class CreateSkillRequest(BaseModel):
    name: str
    pip_package: str | None = None
    description: str | None = None


async def seed_skills() -> None:
    """Scan SKILLS_DIR, parse YAML frontmatter from SKILL.md files, upsert into skills table."""
    if not os.path.isdir(SKILLS_DIR):
        logger.info("skills seed: ATOM_SKILLS_DIR=%s not found, skipping", SKILLS_DIR)
        return
    seeded = 0
    async with get_conn() as conn:
        for entry in os.scandir(SKILLS_DIR):
            if not entry.is_dir():
                continue
            skill_md = os.path.join(entry.path, "SKILL.md")
            if not os.path.exists(skill_md):
                continue
            try:
                with open(skill_md) as f:
                    raw = f.read()
                parts = raw.split("---", 2)
                if len(parts) < 3:
                    continue
                meta = yaml.safe_load(parts[1])
                if not meta or "name" not in meta:
                    continue
                await conn.execute(
                    """
                    INSERT INTO skills (name, description, dir, builtin)
                    VALUES ($1, $2, $3, true)
                    ON CONFLICT (name) DO UPDATE
                        SET description = EXCLUDED.description,
                            dir = EXCLUDED.dir
                    """,
                    meta["name"],
                    meta.get("description", ""),
                    entry.name,
                )
                seeded += 1
            except Exception as exc:
                logger.warning("skills seed: failed to parse %s: %s", skill_md, exc)
    logger.info("skills seed: %d skill(s) upserted from %s", seeded, SKILLS_DIR)


@router.get("/")
async def list_skills(_: dict = Depends(require_auth)):
    async with get_conn() as conn:
        rows = await conn.fetch(
            "SELECT id, name, description, pip_package, dir, builtin, is_active, created_at"
            " FROM skills WHERE is_active=true ORDER BY name"
        )
    return [dict(r) for r in rows]


@router.get("/{skill_name}/content")
async def get_skill_content(skill_name: str, _: dict = Depends(require_auth)):
    """Return raw SKILL.md content for the side drawer."""
    async with get_conn() as conn:
        row = await conn.fetchrow(
            "SELECT dir FROM skills WHERE name=$1 AND is_active=true",
            skill_name,
        )
    if not row or not row["dir"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="skill not found or has no directory")
    skill_md = os.path.join(SKILLS_DIR, row["dir"], "SKILL.md")
    if not os.path.exists(skill_md):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="SKILL.md file not found on disk")
    with open(skill_md) as f:
        content = f.read()
    return Response(content=content, media_type="text/plain")


@router.post("/", status_code=201)
async def create_skill(req: CreateSkillRequest, _: dict = Depends(require_auth)):
    async with get_conn() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO skills (name, pip_package, description)
            VALUES ($1,$2,$3)
            RETURNING id, name, description, pip_package, dir, builtin, is_active, created_at
            """,
            req.name,
            req.pip_package,
            req.description,
        )
    return dict(row)


@router.get("/{skill_id}")
async def get_skill(skill_id: str, _: dict = Depends(require_auth)):
    async with get_conn() as conn:
        row = await conn.fetchrow(
            "SELECT id, name, description, pip_package, dir, builtin, is_active, created_at"
            " FROM skills WHERE id=$1",
            skill_id,
        )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="skill not found")
    return dict(row)
