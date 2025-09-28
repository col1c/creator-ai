# app/invites.py — Beta-Invites + Referral (fixed)
from fastapi import APIRouter, Depends, HTTPException, Request
from typing import Optional
from datetime import datetime, timezone
import secrets
from . import supa
from .config import INVITE_REQUIRED

router = APIRouter(prefix="/api/v1/beta", tags=["beta"])

def _code() -> str:
    return secrets.token_hex(3)  # 6 hex chars

def _select_one_sync(path_with_query: str):
    data, _ = supa._get_sync(path_with_query, params=None)
    if isinstance(data, list):
        return data[0] if data else None
    return data

def _insert_sync(path: str, json: dict):
    return supa._post_sync(path, json=json)

def _update_sync(path: str, json: dict, *, eq: Optional[dict] = None):
    params = None
    if eq:
        params = {k: f"eq.{v}" for k, v in eq.items()}
    return supa._patch_sync(path, params=params, json=json)

def get_profile_sync(request: Request) -> dict | None:
    # Read Authorization header -> token -> user -> users_public row
    auth = request.headers.get("authorization") or request.headers.get("Authorization") or ""
    token = auth.replace("Bearer", "").strip()
    if not token:
        return None
    user = supa.get_user_from_token(token)
    uid = user.get("id") or user.get("user", {}).get("id")
    email = user.get("email") or user.get("user", {}).get("email")
    if not uid:
        return None
    rows, _resp = supa._get_sync("/rest/v1/users_public", params={"user_id": f"eq.{uid}", "select": "*"})
    prof = (rows or [{}])[0]
    prof["user_id"] = uid
    prof["email"] = prof.get("email") or email
    return prof

@router.post("/invite/create")
def invite_create(n: int = 1, user=Depends(get_profile_sync)):
    if not user: raise HTTPException(401, "auth")
    n = max(1, min(10, int(n or 1)))
    out = []
    for _ in range(n):
        code = _code()
        _insert_sync("/rest/v1/invites", {"code": code, "created_by": user["user_id"]})
        out.append(code)
    return {"codes": out}

@router.post("/invite/use")
def invite_use(payload: dict, user=Depends(get_profile_sync)):
    if not user: raise HTTPException(401, "auth")
    code = (payload.get("code") or "").strip().lower()
    if not code: raise HTTPException(400, "missing code")
    row = _select_one_sync(f"/rest/v1/invites?code=eq.{code}&select=code,created_by,used_by")
    if not row: raise HTTPException(404, "invalid code")
    if row.get("used_by"): raise HTTPException(400, "already used")
    _update_sync("/rest/v1/invites", {"used_by": user["user_id"], "used_at": datetime.now(timezone.utc).isoformat()}, eq={"code": code})
    _update_sync("/rest/v1/users_public", {"invited": True, "referred_by": code}, eq={"user_id": user["user_id"]})
    _insert_sync("/rest/v1/referrals", {"referrer_user_id": row["created_by"], "referred_user_id": user["user_id"]})
    return {"ok": True, "invited": True}

@router.get("/invite/required")
def invite_required():
    return {"required": INVITE_REQUIRED}
