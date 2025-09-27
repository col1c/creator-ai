# app/export_delete.py
from __future__ import annotations
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import io
import json
import zipfile

import httpx
from fastapi import APIRouter, HTTPException, Request, Response

from . import supa
from .config import settings

router = APIRouter()

# ----- Helpers ---------------------------------------------------------------

async def _uid_from_request(request: Request) -> str:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")
    token = auth.split(" ", 1)[1]
    user = await supa.get_user_from_token(token)
    uid = user.get("id")
    if not uid:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return uid

def _sb_headers_json() -> Dict[str, str]:
    if not settings.SUPABASE_SERVICE_ROLE or not settings.SUPABASE_URL:
        raise HTTPException(status_code=500, detail="Supabase service role / url not configured")
    return {
        "apikey": settings.SUPABASE_SERVICE_ROLE,
        "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Prefer": "return=minimal",
    }

async def _delete_rows(table: str, uid: str) -> dict:
    # DELETE /rest/v1/{table}?user_id=eq.{uid}
    url = f"{settings.SUPABASE_URL}/rest/v1/{table}"
    params = {"user_id": f"eq.{uid}"}
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.request("DELETE", url, headers=_sb_headers_json(), params=params)
        # 204 No Content is success
        if r.status_code not in (200, 204):
            raise HTTPException(status_code=500, detail=f"Delete {table} failed: {r.status_code} {r.text}")
        return {"table": table, "status": r.status_code, "content_range": r.headers.get("content-range")}

async def _delete_auth_user(uid: str) -> dict:
    # DELETE /auth/v1/admin/users/{uid}
    url = f"{settings.SUPABASE_URL}/auth/v1/admin/users/{uid}"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.request("DELETE", url, headers=_sb_headers_json())
        if r.status_code not in (200, 204):
            # Not every project allows admin delete; return info instead of failing hard
            return {"status": r.status_code, "message": r.text}
        return {"status": r.status_code}

# ----- Export ---------------------------------------------------------------

@router.get("/api/v1/export")
async def export_zip(request: Request):
    """Exportiert Nutzerdaten als ZIP mit JSON-Dateien."""
    uid = await _uid_from_request(request)
    now = datetime.now(timezone.utc)

    # Daten einsammeln (Service Role; RLS wird umgangen)
    profile = await supa._get("/rest/v1/users_public", params={
        "user_id": f"eq.{uid}",
        "select": "*",
    }) or []

    generations = await supa._get("/rest/v1/generations", params={
        "user_id": f"eq.{uid}",
        "order": "created_at.asc",
        "select": "*",
    }) or []

    templates = await supa._get("/rest/v1/templates", params={
        "user_id": f"eq.{uid}",
        "order": "created_at.asc",
        "select": "*",
    }) or []

    planner = await supa._get("/rest/v1/planner_slots", params={
        "user_id": f"eq.{uid}",
        "order": "scheduled_at.asc",
        "select": "*",
    }) or []

    since_30 = (now - timedelta(days=30)).isoformat()
    usage_30 = await supa._get("/rest/v1/usage_log", params={
        "user_id": f"eq.{uid}",
        "created_at": f"gte.{since_30}",
        "order": "created_at.asc",
        "select": "*",
    }) or []

    # ZIP in-memory bauen
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("metadata.json", json.dumps({
            "exported_at": now.isoformat(),
            "app_version": "0.4.0",
            "user_id": uid,
            "tables": ["users_public","generations","templates","planner_slots","usage_log(last30)"]
        }, ensure_ascii=False, indent=2))

        z.writestr("users_public.json", json.dumps(profile, ensure_ascii=False, indent=2))
        z.writestr("generations.json", json.dumps(generations, ensure_ascii=False, indent=2))
        z.writestr("templates.json", json.dumps(templates, ensure_ascii=False, indent=2))
        z.writestr("planner_slots.json", json.dumps(planner, ensure_ascii=False, indent=2))
        z.writestr("usage_log_last30.json", json.dumps(usage_30, ensure_ascii=False, indent=2))

    buf.seek(0)
    filename = f"creatorai_export_{now.strftime('%Y%m%d_%H%M%S')}.zip"
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )

# ----- Delete / Purge -------------------------------------------------------

@router.post("/api/v1/delete_account")
async def delete_account(request: Request):
    """
    Löscht Nutzerdaten (purge). Optional: Supabase-Auth-Account löschen.
    Body: { "delete_auth": false }  # default false
    """
    uid = await _uid_from_request(request)
    try:
        body = await request.json()
    except Exception:
        body = {}
    delete_auth = bool(body.get("delete_auth", False))

    purged = []
    # Reihenfolge beachten: abhängige Tabellen zuerst
    for table in ["planner_slots", "templates", "generations", "usage_log", "prompt_cache", "users_public"]:
        try:
            res = await _delete_rows(table, uid)
            purged.append(res)
        except HTTPException as e:
            # Nicht alle Tabellen müssen existieren oder deletable sein -> weiches Ergebnis
            purged.append({"table": table, "error": getattr(e, "detail", str(e))})

    auth_result = None
    if delete_auth:
        try:
            auth_result = await _delete_auth_user(uid)
        except Exception as e:
            auth_result = {"status": "error", "message": str(e)}

    return {
        "ok": True,
        "purged": purged,
        "auth_deleted": bool(delete_auth),
        "auth_result": auth_result,
    }
