# backend/app/account.py
from fastapi import APIRouter, HTTPException, Header, Response
from fastapi.responses import JSONResponse
from typing import Optional, Dict, Any
import requests
from .config import settings
from .supa import get_user_from_token

router = APIRouter(prefix="/api/v1", tags=["account"])

def _require_uid(authorization: Optional[str]) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "auth")
    token = authorization.split(" ", 1)[1].strip()
    user = get_user_from_token(token)
    uid = user.get("id")
    if not uid:
        raise HTTPException(401, "auth")
    return uid

def _sr_headers(extra: Dict[str, str] | None = None) -> Dict[str, str]:
    h = {
        "apikey": settings.SUPABASE_SERVICE_ROLE,
        "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE}",
    }
    if extra:
        h.update(extra)
    return h

def _get_user_rows(table: str, uid: str) -> list[dict]:
    r = requests.get(
        f"{settings.SUPABASE_URL}/rest/v1/{table}",
        headers=_sr_headers(),
        params={"user_id": f"eq.{uid}", "select": "*", "order": "created_at.asc"},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()

@router.get("/export")
def export_account(authorization: Optional[str] = Header(None)):
    uid = _require_uid(authorization)

    # users_public separat (single row)
    pub = requests.get(
        f"{settings.SUPABASE_URL}/rest/v1/users_public",
        headers=_sr_headers(),
        params={"user_id": f"eq.{uid}", "select": "*"},
        timeout=30,
    )
    pub.raise_for_status()
    profile = (pub.json() or [None])[0]

    data = {
        "profile": profile,
        "generations": _get_user_rows("generations", uid),
        "templates": _get_user_rows("templates", uid),
        "planner_slots": _get_user_rows("planner_slots", uid),
        "usage_log": _get_user_rows("usage_log", uid),
        "daily_ideas": _get_user_rows("daily_ideas", uid) if settings.SUPABASE_URL else [],
        "prompt_cache": _get_user_rows("prompt_cache", uid) if settings.SUPABASE_URL else [],
    }

    return JSONResponse(
        content=data,
        headers={"Content-Disposition": 'attachment; filename="creatorai_export.json"'},
    )

@router.post("/delete_account")
def delete_account(authorization: Optional[str] = Header(None)):
    uid = _require_uid(authorization)

    # Reihenfolge: Kindtabellen -> users_public -> auth user
    def _del(table: str):
        r = requests.delete(
            f"{settings.SUPABASE_URL}/rest/v1/{table}",
            headers=_sr_headers({"Prefer": "return=representation"}),
            params={"user_id": f"eq.{uid}"},
            timeout=30,
        )
        if r.status_code >= 400:
            raise HTTPException(400, f"delete {table} failed: {r.text}")

    for table in ["planner_slots", "generations", "templates", "usage_log", "prompt_cache", "daily_ideas"]:
        try:
            _del(table)
        except Exception:
            # tolerieren, falls Tabelle nicht existiert
            pass

    # users_public
    r = requests.delete(
        f"{settings.SUPABASE_URL}/rest/v1/users_public",
        headers=_sr_headers({"Prefer": "return=representation"}),
        params={"user_id": f"eq.{uid}"},
        timeout=30,
    )
    if r.status_code >= 400:
        raise HTTPException(400, f"delete users_public failed: {r.text}")

    # auth admin delete (Service-Role)
    ar = requests.delete(
        f"{settings.SUPABASE_URL}/auth/v1/admin/users/{uid}",
        headers=_sr_headers(),
        timeout=30,
    )
    if ar.status_code not in (200, 204):
        # nicht hart failen, aber melden
        return {"ok": True, "auth_deleted": False, "auth_response": ar.text}

    return {"ok": True, "auth_deleted": True}
