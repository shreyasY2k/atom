from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..auth.middleware import require_auth
from .service import create_domain, delete_domain, get_domain, list_domains, update_domain

router = APIRouter()


class CreateDomainRequest(BaseModel):
    name: str
    description: str | None = None


class UpdateDomainRequest(BaseModel):
    name: str | None = None
    description: str | None = None


@router.get("/")
async def list_domains_route(claims: dict = Depends(require_auth)):
    return await list_domains()


@router.post("/", status_code=201)
async def create_domain_route(req: CreateDomainRequest, claims: dict = Depends(require_auth)):
    try:
        domain = await create_domain(req.name, req.description, claims["sub"])
    except RuntimeError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=str(e))
    return domain


@router.get("/{domain_id}")
async def get_domain_route(domain_id: str, _: dict = Depends(require_auth)):
    domain = await get_domain(domain_id)
    if not domain:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="domain not found")
    return domain


@router.patch("/{domain_id}")
async def update_domain_route(
    domain_id: str, req: UpdateDomainRequest, _: dict = Depends(require_auth)
):
    domain = await update_domain(domain_id, req.name, req.description)
    if not domain:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="domain not found")
    return domain


@router.delete("/{domain_id}", status_code=204)
async def delete_domain_route(domain_id: str, _: dict = Depends(require_auth)):
    ok = await delete_domain(domain_id)
    if not ok:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail="domain not found or already inactive"
        )
