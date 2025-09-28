# app/planner_api.py
from fastapi import APIRouter, Depends, HTTPException, Header
from typing import Optional
from .supa import update_sync, _get_sync, _post_sync, _delete_sync, get_user_from_token, get_profile


router = APIRouter(prefix="/api/v1/planner", tags=["planner"])

def require_user(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "auth")
    token = authorization.split(" ", 1)[1]
    uid = get_user_from_token(token).get("id")
    if not uid:
        raise HTTPException(401, "auth")
    prof = get_profile(uid) or {"user_id": uid}
    return prof

@router.get("/slots")
def list_slots(user=Depends(require_user), date_from: Optional[str] = None, date_to: Optional[str] = None):
    params = {
        "user_id": f"eq.{user['user_id']}",
        "select": "*",
        "order": "scheduled_at.asc",
    }
    return _get_sync("/rest/v1/planner_slots", params)[0] or []

@router.post("/slots")
def create_slot(payload: dict, user=Depends(require_user)):
    data = {
        "user_id": user["user_id"],
        "platform": payload["platform"],
        "scheduled_at": payload["scheduled_at"],
        "generation_id": payload.get("generation_id"),
        "note": payload.get("note"),
    }
    return _post_sync("/rest/v1/planner_slots", data)

@router.delete("/slots/{slot_id}")
def delete_slot(slot_id: int, user=Depends(require_user)):
    _delete_sync(f"/rest/v1/planner_slots?id=eq.{slot_id}")
    return {"ok": True}

def _require_auth(authorization: str | None):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "auth")

@router.patch("/slots/{slot_id}")
def update_slot(slot_id: int, payload: dict, authorization: str | None = Header(None)):
    _require_auth(authorization)
    # erlaubte Felder
    data = {k:v for k,v in payload.items() if k in ("scheduled_at","platform","note","generation_id")}
    if not data: return {"ok": True}
    update_sync("/rest/v1/planner_slots", data, eq={"id": slot_id})
    return {"ok": True}

@router.post("/slots/reorder")
def reorder_slots(payload: dict, authorization: str | None = Header(None)):
    _require_auth(authorization)
    items = payload.get("items") or []
    for it in items:
        sid = it.get("id"); when = it.get("scheduled_at")
        if sid and when:
            update_sync("/rest/v1/planner_slots", {"scheduled_at": when}, eq={"id": sid})
    return {"ok": True}