# backend/app/planner_api.py
from fastapi import APIRouter, HTTPException, Header, Request, Path, Query
from typing import Optional, Dict, Any
import os, requests
from .supa import get_user_from_token, _get_sync, _post_sync, _delete_sync

router = APIRouter(prefix="/api/v1/planner", tags=["planner"])

# ----------------- Supabase low-level helpers (PATCH) -----------------

def _sb_base() -> str:
    base = os.environ.get("SUPABASE_URL")
    if not base:
        raise RuntimeError("SUPABASE_URL missing")
    return base.rstrip("/")

def _sr_headers() -> Dict[str, str]:
    sr = os.environ.get("SUPABASE_SERVICE_ROLE")
    if not sr:
        raise RuntimeError("SUPABASE_SERVICE_ROLE missing")
    return {"apikey": sr, "Authorization": f"Bearer {sr}", "Content-Type": "application/json"}

def _patch_sync(table: str, patch: dict, where: Dict[str, Any]) -> None:
    """
    PATCH /rest/v1/{table}?col=eq.value&...
    """
    params = {}
    for k, v in where.items():
        params[k] = f"eq.{v}"
    r = requests.patch(
        f"{_sb_base()}/rest/v1/{table}",
        headers={**_sr_headers(), "Prefer": "return=minimal"},
        params=params,
        json=patch,
        timeout=30,
    )
    if r.status_code >= 400:
        raise RuntimeError(f"supabase PATCH {table} failed: {r.status_code} {r.text}")

# ----------------- Auth helper -----------------

def _require_uid(authorization: Optional[str]) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "auth")
    token = authorization.split(" ", 1)[1].strip()
    user = get_user_from_token(token)
    uid = user.get("id")
    if not uid:
        raise HTTPException(401, "auth")
    return uid

# ----------------- Endpoints -----------------

@router.get("/slots")
def list_slots(
    authorization: Optional[str] = Header(None),
    limit: int = Query(200, ge=1, le=500),
):
    uid = _require_uid(authorization)
    rows, _ = _get_sync("/rest/v1/planner_slots", {
        "select": "id,platform,scheduled_at,generation_id,note,reminder_sent,created_at",
        "user_id": f"eq.{uid}",
        "order": "scheduled_at.asc",
        "limit": str(limit),
    })
    return {"items": rows or []}

@router.post("/slots")
def create_slot(payload: dict, authorization: Optional[str] = Header(None)):
    """
    Body: { platform, scheduled_at (ISO), note?, generation_id? }
    """
    uid = _require_uid(authorization)
    platform = (payload.get("platform") or "").lower()
    scheduled_at = payload.get("scheduled_at")
    if platform not in ("tiktok", "instagram", "youtube", "shorts", "reels", "other"):
        raise HTTPException(400, "invalid platform")
    if not scheduled_at:
        raise HTTPException(400, "scheduled_at required")

    row, _ = _post_sync("/rest/v1/planner_slots", {
        "user_id": uid,
        "platform": platform,
        "scheduled_at": scheduled_at,
        "note": payload.get("note") or None,
        "generation_id": payload.get("generation_id") or None,
    })
    # _post_sync sollte eine Liste zurückgeben
    item = row[0] if isinstance(row, list) and row else row
    return {"item": item}

@router.patch("/slots/{slot_id}")
def update_slot(
    slot_id: int = Path(..., ge=1),
    payload: dict = None,
    authorization: Optional[str] = Header(None),
):
    """
    Erlaubte Felder: platform, scheduled_at, note, generation_id, reminder_sent
    """
    uid = _require_uid(authorization)
    if not isinstance(payload, dict):
        payload = {}

    patch = {k: v for k, v in payload.items()
             if k in ("platform", "scheduled_at", "note", "generation_id", "reminder_sent")}
    if not patch:
        return {"ok": True, "noop": True}

    # Sicherheit: Nur eigene Zeile anfassen
    _patch_sync("planner_slots", patch, {"id": slot_id, "user_id": uid})
    return {"ok": True}

@router.delete("/slots/{slot_id}")
def delete_slot(slot_id: int = Path(..., ge=1), authorization: Optional[str] = Header(None)):
    uid = _require_uid(authorization)
    # Sicherheit: filter auf user_id + id
    _, status = _delete_sync("/rest/v1/planner_slots", {
        "id": f"eq.{slot_id}",
        "user_id": f"eq.{uid}",
    })
    if status and status >= 400:
        raise HTTPException(400, "delete failed")
    return {"ok": True}
