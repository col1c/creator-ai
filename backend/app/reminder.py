# app/reminder.py
from datetime import datetime, timezone, timedelta
import os
from typing import List, Dict, Any

from fastapi import APIRouter, HTTPException, Request, Query
from . import supa

router = APIRouter()

# --- Helpers ---------------------------------------------------------------

async def _uid_and_email_from_request(request: Request) -> tuple[str, str]:
    auth = request.headers.get("authorization") or request.headers.get("Authorization") or ""
    token = auth.replace("Bearer", "").strip()
    if not token:
        raise HTTPException(401, "missing bearer token")
    user_info = await supa.get_user_from_token(token)
    uid = (user_info.get("user") or {}).get("id") or user_info.get("id")
    email = (user_info.get("user") or {}).get("email") or user_info.get("email") or ""
    if not uid:
        raise HTTPException(401, "invalid token")
    return uid, email

def _fmt_local(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M UTC")

async def _load_upcoming_slots(uid: str, hours: int) -> List[Dict[str, Any]]:
    now = datetime.now(timezone.utc)
    until = now + timedelta(hours=hours)
    items = await supa._get(
        "/rest/v1/planner_slots",
        params={
            "user_id": f"eq.{uid}",
            "order": "scheduled_at.asc",
        },
    )
    out: List[Dict[str, Any]] = []
    for it in (items or []):
        iso = it.get("scheduled_at")
        if not iso:
            continue
        try:
            dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00")).astimezone(timezone.utc)
        except Exception:
            continue
        if now <= dt <= until:
            out.append({**it, "_dt": dt})
    return out

async def _send_via_mailgun(to_email: str, subject: str, text: str) -> Dict[str, Any]:
    api_key = os.getenv("MAILGUN_API_KEY")
    domain = os.getenv("MAILGUN_DOMAIN")
    sender = os.getenv("MAILGUN_SENDER", f"CreatorAI <mailgun@{domain or 'example.com'}>")

    if not (api_key and domain):
        return {"status": "noop", "reason": "missing_mailgun_env"}

    try:
        import httpx
    except Exception:
        return {"status": "noop", "reason": "httpx_not_installed"}

    url = f"https://api.mailgun.net/v3/{domain}/messages"
    auth = ("api", api_key)
    data = {"from": sender, "to": [to_email], "subject": subject, "text": text}

    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(url, auth=auth, data=data)
        return {"status": "ok" if r.status_code < 300 else "error", "code": r.status_code, "body": r.text}

# --- Core ------------------------------------------------------------------

async def _remind_core(request: Request, hours: int) -> Dict[str, Any]:
    env = os.getenv("ENV", "dev")
    # In prod blocken? -> auskommentiert lassen, falls du es brauchst:
    # if env == "prod":
    #     raise HTTPException(403, "Manual remind not allowed in production")

    uid, email = await _uid_and_email_from_request(request)
    slots = await _load_upcoming_slots(uid, hours)

    lines = [f"Deine geplanten Posts (nächste {hours}h):", ""]
    if not slots:
        lines.append("Keine Einträge im Zeitraum.")
    else:
        for it in slots:
            platform = (it.get("platform") or "post").title()
            note = it.get("note") or ""
            dt = it["_dt"]
            lines.append(f"• {platform} – {_fmt_local(dt)}  {('— ' + note) if note else ''}")

    result = await _send_via_mailgun(
        to_email=email or os.getenv("DEV_FALLBACK_EMAIL", ""),
        subject="CreatorAI Planner – Erinnerung",
        text="\n".join(lines),
    )

    return {
        "env": env,
        "to": email or os.getenv("DEV_FALLBACK_EMAIL", ""),
        "count": len(slots),
        "mail": result,
    }

# --- Routes (POST + Alias + GET-Fallback) ---------------------------------

# Ursprünglicher DEV-Path unter /planner/*
@router.post("/api/v1/planner/remind/self")
async def planner_remind_self_post(request: Request, hours: int = Query(24, ge=1, le=168)):
    return await _remind_core(request, hours)

# Alias OHNE /planner, um Kollisionen zu vermeiden
@router.post("/api/v1/remind/self")
async def remind_self_post(request: Request, hours: int = Query(24, ge=1, le=168)):
    return await _remind_core(request, hours)

# GET-Fallback, falls Proxy/Rules POST blocken
@router.get("/api/v1/remind/self")
async def remind_self_get(request: Request, hours: int = Query(24, ge=1, le=168)):
    return await _remind_core(request, hours)


from fastapi import Header
from .config import settings

@router.post("/api/v1/planner/remind_all")
async def planner_remind_all(x_cron_secret: str | None = Header(None), hours: int = Query(24, ge=1, le=168)):
    if not settings.CRON_SECRET or (x_cron_secret != settings.CRON_SECRET):
        raise HTTPException(403, "forbidden")
    rows = supa.get_upcoming_slots(hours_ahead=hours) or []
    grouped = {}
    for r in rows:
        uid = r.get("user_id")
        email = (r.get("users_public") or {}).get("email")
        if not uid or not email:
            continue
        grouped.setdefault(uid, {"email": email, "slots": []})["slots"].append(r)
    ok = 0; fail = 0
    for uid, obj in grouped.items():
        try:
            lines = ["Deine geplanten Posts in den nächsten Stunden:"]
            for s in obj["slots"]:
                lines.append(f"- {s.get('platform')} @ {s.get('scheduled_at')} {(s.get('note') or '').strip()}")
            subj = "Reminder: Geplante Posts"
            await _send_via_mailgun(obj["email"], subj, "\n".join(lines))
            ok += 1
        except Exception:
            fail += 1
    return {"ok": ok, "fail": fail, "users": len(grouped)}
