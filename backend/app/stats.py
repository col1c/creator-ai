# backend/app/stats.py
from fastapi import APIRouter, Header, HTTPException
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, List, Set
from .supa import _get_sync, get_user_from_token

router = APIRouter(prefix="/api/v1", tags=["stats"])

def require_token(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "auth")
    return authorization.split(" ", 1)[1]

@router.get("/stats")
def get_stats(authorization: str | None = Header(None)):
    # auth (nur eingeloggte Nutzer; du kannst hier optional Admin-Gate einziehen)
    token = require_token(authorization)
    _ = get_user_from_token(token)  # validiert Token

    now = datetime.now(timezone.utc)
    d7  = now - timedelta(days=7)
    d28 = now - timedelta(days=28)
    d30 = now - timedelta(days=30)

    # users_total
    users, _ = _get_sync("/rest/v1/users_public", {"select": "user_id"})
    users_total = len(users or [])

    # usage 30d
    usage_30d, _ = _get_sync("/rest/v1/usage_log", {
        "select": "user_id,event,created_at",
        "created_at": f"gte.{d30.isoformat()}",
        "order": "created_at.desc",
        "limit": 10000
    })  # limit als Schutz; bei Bedarf paginieren

    # counts
    active_users_7d: Set[str] = set()
    active_users_28d: Set[str] = set()
    saves_30d = 0
    planner_add_30d = 0

    for row in usage_30d or []:
        uid = row.get("user_id")
        ev  = (row.get("event") or "").lower()
        ts  = datetime.fromisoformat(row["created_at"].replace("Z","+00:00")) if row.get("created_at") else now
        if ts >= d7:  active_users_7d.add(uid)
        if ts >= d28: active_users_28d.add(uid)
        if ev in ("save","favorite_toggle"):
            saves_30d += 1
        if ev in ("planner_add","planner_slot_add"):
            planner_add_30d += 1

    # generations 30d
    gens_30d, _ = _get_sync("/rest/v1/generations", {
        "select": "id,user_id,input,created_at",
        "created_at": f"gte.{d30.isoformat()}",
        "order": "created_at.desc",
        "limit": 10000
    })
    generations_30d = len(gens_30d or [])

    # Top-Themen/Nischen 30d (aus generations.input.niche/topic + users_public.niche)
    top_topics: Dict[str,int] = {}
    top_niches_gens: Dict[str,int] = {}
    for g in gens_30d or []:
        inp = g.get("input") or {}
        topic = (inp.get("topic") or "").strip().lower()
        niche = (inp.get("niche") or "").strip().lower()
        if topic: top_topics[topic] = top_topics.get(topic, 0) + 1
        if niche: top_niches_gens[niche] = top_niches_gens.get(niche, 0) + 1

    # Aktivierungen 30d: Heuristik via usage_log – save + planner_add innerhalb 24h
    # (optional: onboarding_done aus users_public)
    activation_users: Set[str] = set()
    by_user: Dict[str, List[Dict[str,Any]]] = {}
    for r in usage_30d or []:
        by_user.setdefault(r["user_id"], []).append(r)
    for uid, rows in by_user.items():
        rows_sorted = sorted(rows, key=lambda r: r["created_at"])
        first_save = None
        planner_ok = False
        for r in rows_sorted:
            ev = (r.get("event") or "").lower()
            ts = datetime.fromisoformat(r["created_at"].replace("Z","+00:00"))
            if ev in ("save","favorite_toggle") and first_save is None:
                first_save = ts
            if ev in ("planner_add","planner_slot_add") and first_save:
                if ts <= first_save + timedelta(hours=24):
                    planner_ok = True
                    break
        if first_save and planner_ok:
            activation_users.add(uid)

    # users_public.niche Top-Liste der aktiven letzten 30d
    recent_user_ids = list(set([r["user_id"] for r in usage_30d or []]))
    top_niches_users: Dict[str,int] = {}
    if recent_user_ids:
        id_list = ",".join(recent_user_ids[:10000])  # safeguard
        rows, _ = _get_sync("/rest/v1/users_public", {
            "select": "user_id,niche",
            "user_id": f"in.({id_list})"
        })
        for r in rows or []:
            niche = (r.get("niche") or "").strip().lower()
            if niche:
                top_niches_users[niche] = top_niches_users.get(niche, 0) + 1

    return {
        "window_days": 30,
        "generated_at": now.isoformat(),
        "totals": {
            "users_total": users_total,
            "generations_30d": generations_30d,
            "saves_30d": saves_30d,
            "planner_add_30d": planner_add_30d,
            "active_users_7d": len(active_users_7d),
            "active_users_28d": len(active_users_28d),
            "activation_users_30d": len(activation_users),
        },
        "top": {
            "topics_30d": sorted([{"name": k, "count": v} for k,v in top_topics.items()], key=lambda x: x["count"], reverse=True)[:10],
            "niches_from_generations_30d": sorted([{"name": k, "count": v} for k,v in top_niches_gens.items()], key=lambda x: x["count"], reverse=True)[:10],
            "niches_from_users_30d": sorted([{"name": k, "count": v} for k,v in top_niches_users.items()], key=lambda x: x["count"], reverse=True)[:10],
        }
    }
