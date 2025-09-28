# backend/app/account.py
from fastapi import APIRouter, Header, HTTPException, Response
from datetime import datetime, timezone
from io import BytesIO
import json, requests, os, zipfile
from typing import Optional

from .supa import _get_sync, _delete_sync, get_user_from_token
from .config import SUPABASE_URL, SUPABASE_SERVICE_ROLE

router = APIRouter(prefix="/api/v1", tags=["account"])

def require_uid(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "auth")
    token = authorization.split(" ", 1)[1]
    user = get_user_from_token(token)
    uid = user.get("id")
    if not uid:
        raise HTTPException(401, "auth")
    return uid

@router.post("/delete_account")
def delete_account_post(payload: dict, authorization: Optional[str] = Header(None)):
    # ruft den gleichen Code wie DELETE auf
    return delete_account(payload, authorization)  # vorhandene Funktion wiederverwenden

@router.get("/export")
def export_data(authorization: str | None = Header(None)):
    uid = require_uid(authorization)

    # Pull all user-related tables
    tables = {
        "users_public": ("/rest/v1/users_public", {"select": "*", "user_id": f"eq.{uid}"}),
        "generations":  ("/rest/v1/generations", {"select": "*", "user_id": f"eq.{uid}", "order": "created_at.desc", "limit": 10000}),
        "templates":    ("/rest/v1/templates", {"select": "*", "user_id": f"eq.{uid}", "order": "created_at.desc", "limit": 10000}),
        "planner_slots":("/rest/v1/planner_slots", {"select": "*", "user_id": f"eq.{uid}", "order": "scheduled_at.desc", "limit": 10000}),
        "usage_log":    ("/rest/v1/usage_log", {"select": "*", "user_id": f"eq.{uid}", "order": "created_at.desc", "limit": 10000}),
        "prompt_cache": ("/rest/v1/prompt_cache", {"select": "*", "user_id": f"eq.{uid}", "order": "created_at.desc", "limit": 10000}),
    }

    mem = BytesIO()
    with zipfile.ZipFile(mem, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for name, (path, params) in tables.items():
            rows, _ = _get_sync(path, params)
            zf.writestr(f"{name}.json", json.dumps(rows or [], ensure_ascii=False, indent=2))
    mem.seek(0)

    fname = f"creator-ai-export-{datetime.now(timezone.utc).date().isoformat()}.zip"
    return Response(
        content=mem.read(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'}
    )

@router.delete("/delete_account")
def delete_account(authorization: str | None = Header(None)):
    uid = require_uid(authorization)

    # Delete rows (own data). RLS erlaubt delete für eigene Zeilen; Service-Role falls benötigt.
    _delete_sync(f"/rest/v1/prompt_cache?user_id=eq.{uid}")
    _delete_sync(f"/rest/v1/planner_slots?user_id=eq.{uid}")
    _delete_sync(f"/rest/v1/templates?user_id=eq.{uid}")
    _delete_sync(f"/rest/v1/generations?user_id=eq.{uid}")
    _delete_sync(f"/rest/v1/usage_log?user_id=eq.{uid}")
    _delete_sync(f"/rest/v1/users_public?user_id=eq.{uid}")

    # Optional: Auth-User löschen (Admin API) – benötigt Service Role
    if SUPABASE_URL and SUPABASE_SERVICE_ROLE:
        try:
            requests.delete(
                f"{SUPABASE_URL}/auth/v1/admin/users/{uid}",
                headers={
                    "apikey": SUPABASE_SERVICE_ROLE,
                    "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE}",
                },
                timeout=15
            )
        except Exception:
            # Nicht hart fehlschlagen – Nutzer-Daten sind gelöscht; Auth kann nachgezogen werden
            pass

    return {"ok": True}
