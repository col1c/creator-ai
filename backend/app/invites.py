# app/invites.py
from fastapi import APIRouter, Depends, HTTPException, Header
from datetime import datetime, timezone
import secrets, os
from .supa import _post_sync, _get_sync, _patch_sync, get_user_from_token, get_profile

router = APIRouter(prefix="/api/v1/beta", tags=["beta"])

def require_user(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "auth")
    token = authorization.split(" ", 1)[1]
    user = get_user_from_token(token)  # await-bar, aber sync nutzbar
    uid = user.get("id")
    if not uid:
        raise HTTPException(401, "auth")
    prof = get_profile(uid) or {"user_id": uid, "email": user.get("email")}
    return prof

@router.post("/invite/create")
def invite_create(n: int = 1, user=Depends(require_user)):
    n = max(1, min(n, 10))
    codes = []
    for _ in range(n):
        code = secrets.token_hex(3)
        _post_sync("/rest/v1/invites", {"code": code, "created_by": user["user_id"]})
        codes.append(code)
    return {"codes": codes}

@router.get("/invite/my")
def invite_my(user=Depends(require_user)):
    rows, _ = _get_sync("/rest/v1/invites", {
        "select": "code,used_by,used_at,created_at",
        "created_by": f"eq.{user['user_id']}",
        "order": "created_at.desc",
    })
    return {"invites": rows or []}

@router.post("/invite/use")
def invite_use(payload: dict, user=Depends(require_user)):
    code = (payload.get("code") or "").strip().lower()
    if not code:
        raise HTTPException(400, "missing code")
    rows, _ = _get_sync("/rest/v1/invites", {
        "select": "code,created_by,used_by",
        "code": f"eq.{code}",
        "limit": 1,
    })
    if not rows:
        raise HTTPException(404, "invalid code")
    row = rows[0]
    if row.get("used_by"):
        raise HTTPException(400, "already used")

    _patch_sync("/rest/v1/invites", params={"code": f"eq.{code}"}, json={
        "used_by": user["user_id"],
        "used_at": datetime.now(timezone.utc).isoformat(),
    })
    _patch_sync("/rest/v1/users_public", params={"user_id": f"eq.{user['user_id']}"}, json={
        "invited": True,
        "referred_by": code,
    })
    _post_sync("/rest/v1/referrals", {
        "referrer_user_id": row["created_by"],
        "referred_user_id": user["user_id"],
    })
    return {"ok": True, "invited": True}

@router.get("/invite/required")
def invite_required():
    return {"required": os.getenv("INVITE_REQUIRED", "false").lower() == "true"}
