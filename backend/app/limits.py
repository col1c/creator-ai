# backend/app/limits.py
from fastapi import APIRouter, Header, HTTPException
from datetime import datetime, timezone
from calendar import monthrange
from typing import Optional
from .supa import _get_sync, get_user_from_token

router = APIRouter(prefix="/api/v1", tags=["limits"])

def _require_user(authorization: Optional[str]):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "auth")
    token = authorization.split(" ", 1)[1]
    user = get_user_from_token(token)
    if not user or not user.get("id"):
        raise HTTPException(401, "auth")
    return user

@router.get("/me/limits")
def me_limits(authorization: Optional[str] = Header(None)):
    user = _require_user(authorization)
    uid = user["id"]

    now = datetime.now(timezone.utc)
    start_month = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
    end_month = datetime(now.year, now.month, monthrange(now.year, now.month)[1], 23, 59, 59, tzinfo=timezone.utc)

    # profile
    prof_rows, _ = _get_sync("/rest/v1/users_public", {"select": "monthly_credit_limit,plan", "user_id": f"eq.{uid}"})
    prof = prof_rows[0] if prof_rows else {}
    base_limit = int(prof.get("monthly_credit_limit") or 50)
    plan = (prof.get("plan") or "free").lower()

    # used = generations this month
    gens, _ = _get_sync("/rest/v1/generations", {
        "select": "id",
        "user_id": f"eq.{uid}",
        "created_at": f"gte.{start_month.isoformat()}",
        "order":"created_at.desc",
        "limit":10000
    })
    used = len(gens or [])

    # referrals this month
    refs, _ = _get_sync("/rest/v1/referrals", {
        "select": "id",
        "referrer_user_id": f"eq.{uid}",
        "created_at": f"gte.{start_month.isoformat()}",
        "order":"created_at.desc",
        "limit": 10000
    })
    ref_cnt = len(refs or [])
    referral_bonus = 20 * (ref_cnt // 3)

    effective_limit = base_limit + referral_bonus
    if plan in ("pro", "team"):
        # praktisch unbegrenzt – hoher Cap damit UI sauber rechnen kann
        effective_limit = max(effective_limit, 10000)

    remaining = max(0, effective_limit - used)

    return {
        "month": start_month.strftime("%Y-%m"),
        "plan": plan,
        "base_limit": base_limit,
        "referrals_this_month": ref_cnt,
        "referral_bonus": referral_bonus,
        "effective_limit": effective_limit,
        "used_this_month": used,
        "remaining": remaining
    }
