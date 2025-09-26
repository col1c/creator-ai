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
    email = (user_info.get("user") or {}).get("email") or user_info.get("email")
    if not uid:
        raise HTTPException(401, "invalid token")
    if not email:
        # optional fallback: Profil aus DB ziehen, wenn du user_emails in Profiles spiegelst
        email = ""
    return uid, email

def _fmt_local(dt: datetime) -> str:
    # Anzeige in UTC, Clients zeigen lokal an – für Mail reicht ISO
    return dt.strftime("%Y-%m-%d %H:%M UTC")

async def _load_upcoming_slots(uid: str, hours: int) -> List[Dict[str, Any]]:
    now = datetime.now(timezone.utc)
    until = now + timedelta(hours=hours)
    # Hole Slots des Users (sortiert), filter lokal auf Zeitraum
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
        # Dev-Fallback: kein Mailgun → "fake" Senden
        return {"status": "noop", "reason": "missing_mailgun_env"}

    # httpx optional – import hier, damit es kein Global-Import ist
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

# --- Routes ---------------------------------------------------------------

@router.post("/api/v1/planner/remind/self")
async def planner_remind_self(
    request: Request,
    hours: int = Query(24, ge=1, le=168)  # bis 7 Tage
):
    """
    DEV-freundlicher Trigger:
    - Kein X-Cron-Secret nötig
    - Sendet Reminder nur für den eingeloggten User
    - In PROD kannst du per ENV blocken, wenn gewünscht
    """
    env = os.getenv("ENV", "dev")
    # Wenn du in PROD blocken willst, ent-kommentieren:
    # if env == "prod":
    #     raise HTTPException(403, "Manual remind not allowed in production")

    uid, email = await _uid_and_email_from_request(request)
    slots = await _load_upcoming_slots(uid, hours)

    # Mail-Body
    lines = [f"Deine geplanten Posts (nächste {hours}h):", ""]
    if not slots:
        lines.append("Keine Einträge im Zeitraum.")
    else:
        for it in slots:
            platform = (it.get("platform") or "post").title()
            note = it.get("note") or ""
            dt = it["_dt"]
            lines.append(f"• {platform} – { _fmt_local(dt) }  {('— ' + note) if note else ''}")
    body = "\n".join(lines)

    result = await _send_via_mailgun(
        to_email=email or os.getenv("DEV_FALLBACK_EMAIL", ""),
        subject="CreatorAI Planner – Erinnerung",
        text=body,
    )

    return {
        "env": env,
        "to": email or os.getenv("DEV_FALLBACK_EMAIL", ""),
        "count": len(slots),
        "mail": result,
    }
