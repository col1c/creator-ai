# backend/app/daily3.py
from fastapi import APIRouter, Header, HTTPException
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List
import os, json, requests
from .supa import _get_sync, _post_sync, get_user_from_token
from .config import settings

router = APIRouter(prefix="/api/v1", tags=["daily3"])

def _require_user(authorization: str | None):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "auth")
    token = authorization.split(" ", 1)[1]
    user = get_user_from_token(token)
    if not user or not user.get("id"):
        raise HTTPException(401, "auth")
    return user

def _today_utc():
    now = datetime.now(timezone.utc)
    return datetime(now.year, now.month, now.day, tzinfo=timezone.utc)

def _gen_with_llm(niche: str, target: str, tone: str) -> List[Dict[str,Any]]:
    # HINWEIS: nutze settings.*, nicht mehr Modul-Konstanten
    if not settings.OPENROUTER_API_KEY or not settings.OPENROUTER_MODEL:
        return [
            {"hook": f"3 Fehler in {niche}", "script": "Kurzes Skript …", "caption": "Heute lernst du …", "hashtags": ["#"+niche.replace(" ",""), "#tipps", "#creator"]},
            {"hook": f"Schneller {niche}-Hack", "script": "Kurzes Skript …", "caption": "So machst du es …", "hashtags": ["#"+niche.replace(" ",""), "#howto"]},
            {"hook": f"Niemand sagt dir das über {niche}", "script": "Kurzes Skript …", "caption": "Wichtig für "+target, "hashtags": ["#"+niche.replace(" ",""), "#shorts"]},
        ]

    prompt = f"""
Du bist ein Shortform-Creator-Assistent.
Zielgruppe: {target or 'Allgemein'}; Nische: {niche or 'Creator'}; Ton: {tone or 'locker'}.
Erzeuge GENAU 3 Sets im JSON-Array. Jedes Set hat:
- "hook" (<= 9 Wörter),
- "script" (~100 Wörter, Struktur: Hook → 3 Value-Punkte → CTA),
- "caption" (1 Satz),
- "hashtags" (12 Tags, 70% Nische, 30% breit, ohne Verbote).
Gib NUR JSON aus.
""".strip()

    headers = {
        "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
    }
    body = {
        "model": settings.OPENROUTER_MODEL,
        "messages": [
            {"role":"system","content":"Antworte knapp und NUR im JSON-Format."},
            {"role":"user","content": prompt}
        ],
    }
    if (os.getenv("LLM_JSON_MODE","off").lower()=="on") or (settings.LLM_JSON_MODE or "").lower()=="on":
        body["response_format"] = {"type":"json_object"}

    r = requests.post("https://openrouter.ai/api/v1/chat/completions", headers=headers, json=body, timeout=60)
    r.raise_for_status()
    txt = r.json()["choices"][0]["message"]["content"]
    try:
        data = json.loads(txt)
        arr = data if isinstance(data, list) else (list(data.values())[0] if isinstance(data, dict) else [])
        out=[]
        for it in arr:
            out.append({
                "hook": str(it.get("hook","")).strip(),
                "script": str(it.get("script","")).strip(),
                "caption": str(it.get("caption","")).strip(),
                "hashtags": it.get("hashtags",[]),
            })
        return out[:3]
    except Exception:
        # Fallback auf einfache Vorschläge
        return _gen_with_llm(niche, target, tone=None)

def _ensure_today(uid: str) -> List[Dict[str,Any]]:
    start = _today_utc().isoformat()
    rows, _ = _get_sync("/rest/v1/daily_ideas", {
        "select":"id,idea,meta,created_at",
        "user_id": f"eq.{uid}",
        "created_at": f"gte.{start}",
        "order":"created_at.asc"
    })
    return rows or []

def _profile(uid: str):
    rows, _ = _get_sync("/rest/v1/users_public", {
        "select":"user_id,niche,target,brand_voice",
        "user_id": f"eq.{uid}",
    })
    return rows[0] if rows else {}

@router.get("/daily3")
def get_daily3(authorization: str | None = Header(None)):
    user = _require_user(authorization)
    uid = user["id"]

    today = _ensure_today(uid)
    if len(today) >= 3:
        return today

    prof = _profile(uid)
    tone = (prof.get("brand_voice") or {}).get("tone","locker")
    niche = prof.get("niche") or "Creator"
    target = prof.get("target") or "Anfänger"

    packs = _gen_with_llm(niche, target, tone)
    for i in range(len(today), min(3, len(packs))):
        p = packs[i]
        _post_sync("/rest/v1/daily_ideas", {
            "user_id": uid,
            "idea": p["hook"],
            "meta": p
        })
    return _ensure_today(uid)

@router.post("/daily3/refresh")
def refresh_my_daily3(authorization: str | None = Header(None)):
    user = _require_user(authorization)
    uid = user["id"]
    start = _today_utc().isoformat()
    requests.delete(
        f"{settings.SUPABASE_URL}/rest/v1/daily_ideas",
        headers={"apikey": settings.SUPABASE_SERVICE_ROLE, "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE}"},
        params={"user_id": f"eq.{uid}", "created_at": f"gte.{start}"}
    )
    return get_daily3(authorization)

@router.post("/daily3/refresh_all")
def refresh_all(x_cron_secret: str | None = Header(None)):
    if not settings.CRON_SECRET or x_cron_secret != settings.CRON_SECRET:
        raise HTTPException(403, "forbidden")

    users, _ = _get_sync("/rest/v1/users_public", {
        "select":"user_id,niche,target,brand_voice",
        "order": "created_at.desc",
        "limit": 200
    })
    for u in users or []:
        uid = u["user_id"]
        start = _today_utc().isoformat()
        requests.delete(
            f"{settings.SUPABASE_URL}/rest/v1/daily_ideas",
            headers={"apikey": settings.SUPABASE_SERVICE_ROLE, "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE}"},
            params={"user_id": f"eq.{uid}", "created_at": f"gte.{start}"}
        )
        bv = u.get("brand_voice") or {}
        packs = _gen_with_llm(u.get("niche") or "Creator", u.get("target") or "Anfänger", bv.get("tone","locker"))
        for i in range(min(3, len(packs))):
            p = packs[i]
            _post_sync("/rest/v1/daily_ideas", {
                "user_id": uid,
                "idea": p["hook"],
                "meta": p
            })
    return {"ok": True}
