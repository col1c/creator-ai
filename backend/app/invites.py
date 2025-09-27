# NEU: Beta-Invites + Referral
from fastapi import APIRouter, Depends, HTTPException
from typing import Optional
from datetime import datetime, timezone
import secrets
from .supa import insert_sync, select_one_sync, update_sync, get_profile_sync
from .config import INVITE_REQUIRED

router = APIRouter(prefix="/api/v1/beta", tags=["beta"])

def _code() -> str:
    return secrets.token_hex(3)  # 6 hex chars

@router.post("/invite/create")
def invite_create(n: int = 1, user=Depends(get_profile_sync)):
    if not user: raise HTTPException(401, "auth")
    created = []
    for _ in range(max(1, min(n, 10))):
        code = _code()
        insert_sync("/rest/v1/invites", {"code": code, "created_by": user["user_id"]})
        created.append(code)
    return {"codes": created}

@router.get("/invite/my")
def invite_my(user=Depends(get_profile_sync)):
    if not user: raise HTTPException(401, "auth")
    rows, _ = select_one_sync("/rest/v1/invites?select=code,used_by,used_at,created_at&created_by=eq.%s" % user["user_id"])
    return {"invites": rows or []}

@router.post("/invite/use")
def invite_use(payload: dict, user=Depends(get_profile_sync)):
    if not user: raise HTTPException(401, "auth")
    code = payload.get("code","").strip().lower()
    if not code: raise HTTPException(400, "missing code")
    # invite holen (service role)
    row, _ = select_one_sync("/rest/v1/invites?code=eq.%s&select=code,created_by,used_by" % code)
    if not row: raise HTTPException(404, "invalid code")
    if row.get("used_by"): raise HTTPException(400, "already used")
    # mark use
    update_sync("/rest/v1/invites", {"used_by": user["user_id"], "used_at": datetime.now(timezone.utc).isoformat()}, eq={"code": code})
    # user invited=true & referred_by setzen
    update_sync("/rest/v1/users_public", {"invited": True, "referred_by": code}, eq={"user_id": user["user_id"]})
    # referral registrieren
    insert_sync("/rest/v1/referrals", {"referrer_user_id": row["created_by"], "referred_user_id": user["user_id"]})
    return {"ok": True, "invited": True}

@router.get("/invite/required")
def invite_required():
    return {"required": INVITE_REQUIRED}
