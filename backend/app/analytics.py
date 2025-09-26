# app/analytics.py
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List
from fastapi import APIRouter, HTTPException, Request, Query
from . import supa

router = APIRouter()

# -------- Helpers ------------------------------------------------------------

async def _uid_from_request(request: Request) -> str:
    auth = request.headers.get("authorization") or request.headers.get("Authorization") or ""
    token = auth.replace("Bearer", "").strip()
    if not token:
        raise HTTPException(401, "missing bearer token")
    user = await supa.get_user_from_token(token)
    uid = (user.get("user") or {}).get("id") or user.get("id")
    if not uid:
        raise HTTPException(401, "invalid token")
    return uid

# -------- Routes -------------------------------------------------------------

@router.post("/api/v1/usage")
async def usage_event(request: Request, payload: Dict[str, Any]):
    """
    Loggt ein Usage-Event für den eingeloggten User.
    expected payload: { "event": "save" | "favorite_toggle" | "login" | "...", "meta": {...} }
    """
    uid = await _uid_from_request(request)
    ev = (payload or {}).get("event")
    meta = (payload or {}).get("meta") or {}
    if not ev or not isinstance(ev, str):
        raise HTTPException(422, "missing 'event'")

    body = {
        "user_id": uid,
        "event": ev,
        "meta": meta,
        # created_at: default now() auf DB-Seite
    }
    # Supabase REST insert
    res = await supa._post("/rest/v1/usage_events", json=body, params={"return": "representation"})
    if isinstance(res, dict) and res.get("code") and res.get("code") >= 400:
        raise HTTPException(500, f"usage insert failed: {res}")

    # Einige Clients/Proxys geben Liste zurück; normalize
    if isinstance(res, list) and res:
        res = res[0]
    return {"ok": True, "inserted": res}

@router.get("/api/v1/stats")
async def stats(request: Request, days: int = Query(30, ge=1, le=180)):
    """
    Aggregiert Events der letzten N Tage für den eingeloggten User.
    Output: totals_by_event + daily (Datum -> Count)
    """
    uid = await _uid_from_request(request)
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=days)

    # Hole Events (wir filtern clientseitig nach created_at >= since, falls REST-Filter limitiert ist)
    items = await supa._get(
        "/rest/v1/usage_events",
        params={
            "user_id": f"eq.{uid}",
            "order": "created_at.asc",
            "select": "event,created_at",
        },
    ) or []

    # Filtern + Aggregieren
    totals: Dict[str, int] = {}
    daily: Dict[str, int] = {}
    for it in items:
        ts = it.get("created_at")
        ev = it.get("event")
        if not (ts and ev):
            continue
        try:
            dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00")).astimezone(timezone.utc)
        except Exception:
            continue
        if dt < since:
            continue
        totals[ev] = totals.get(ev, 0) + 1
        dkey = dt.date().isoformat()
        daily[dkey] = daily.get(dkey, 0) + 1

    return {
        "range": {"from": since.isoformat(), "to": now.isoformat(), "days": days},
        "totals_by_event": totals,
        "daily": daily,
        "total": sum(totals.values()),
    }
