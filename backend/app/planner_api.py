# NEU: Planner CRUD als REST (optional – FE nutzt bisher Supabase direkt)
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime
from typing import Optional
from .supa import get_profile_sync, select_sync, insert_sync, delete_sync

router = APIRouter(prefix="/api/v1/planner", tags=["planner"])

@router.get("/slots")
def list_slots(user=Depends(get_profile_sync), date_from: Optional[str]=None, date_to: Optional[str]=None):
    if not user: raise HTTPException(401, "auth")
    query = f"/rest/v1/planner_slots?user_id=eq.{user['user_id']}&select=*&order=scheduled_at.asc"
    # (optional) Filter nach Zeitraum
    return select_sync(query)[0] or []

@router.post("/slots")
def create_slot(payload: dict, user=Depends(get_profile_sync)):
    if not user: raise HTTPException(401, "auth")
    data = {
        "user_id": user["user_id"],
        "platform": payload["platform"],
        "scheduled_at": payload["scheduled_at"],
        "generation_id": payload.get("generation_id"),
        "note": payload.get("note")
    }
    return insert_sync("/rest/v1/planner_slots", data)

@router.delete("/slots/{slot_id}")
def delete_slot(slot_id: int, user=Depends(get_profile_sync)):
    if not user: raise HTTPException(401, "auth")
    # RLS schützt Delete
    delete_sync("/rest/v1/planner_slots?id=eq.%d" % slot_id)
    return {"ok": True}
