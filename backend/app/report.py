# backend/app/report.py
from fastapi import APIRouter, Header, HTTPException
from datetime import datetime, timezone
from typing import Optional, Any, Dict
from .supa import _post_sync, get_user_from_token

router = APIRouter(prefix="/api/v1", tags=["report"])

def require_uid(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "auth")
    token = authorization.split(" ", 1)[1]
    user = get_user_from_token(token)
    uid = user.get("id")
    if not uid:
        raise HTTPException(401, "auth")
    return uid

@router.post("/report")
def create_report(payload: Dict[str, Any], authorization: str | None = Header(None)):
    uid = require_uid(authorization)
    rtype = (payload.get("type") or "abuse").lower()
    message = payload.get("message") or ""
    context = payload.get("context") or {}

    _post_sync("/rest/v1/usage_log", {
        "user_id": uid,
        "event": "report",
        "meta": {
            "type": rtype,
            "message": message,
            "context": context,
        },
    })
    return {"ok": True}
