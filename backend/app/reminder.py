# backend/app/reminder.py
from fastapi import APIRouter, Header, HTTPException
from datetime import datetime, timedelta, timezone
import requests, os
from typing import List, Dict, Any, Optional

from .supa import _get_sync, update_sync, get_user_from_token
from .config import MAILGUN_API_KEY, MAILGUN_DOMAIN, DAILY_EMAIL_FROM, CRON_SECRET

router = APIRouter(prefix="/api/v1", tags=["planner-reminder"])

def _require_user(authorization: Optional[str]):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "auth")
    token = authorization.split(" ", 1)[1]
    user = get_user_from_token(token)
    if not user or not user.get("id"):
        raise HTTPException(401, "auth")
    return user

def _send_mail(to_email: str, subject: str, text: str):
    if not MAILGUN_API_KEY or not MAILGUN_DOMAIN or not DAILY_EMAIL_FROM:
        # In dev environments we silently skip sending
        return {"ok": True, "dev": True}
    resp = requests.post(
        f"https://api.mailgun.net/v3/{MAILGUN_DOMAIN}/messages",
        auth=("api", MAILGUN_API_KEY),
        data={
            "from": DAILY_EMAIL_FROM,
            "to": to_email,
            "subject": subject,
            "text": text,
        },
        timeout=20,
    )
    if resp.status_code >= 300:
        raise HTTPException(500, f"mailgun: {resp.text}")
    return {"ok": True}

def _upcoming_slots_for_user(user_id: str, hours: int = 24) -> List[Dict[str, Any]]:
    now = datetime.now(timezone.utc)
    horizon = now + timedelta(hours=hours)
    rows, _ = _get_sync("/rest/v1/planner_slots", {
        "select": "id,platform,scheduled_at,note,reminder_sent",
        "user_id": f"eq.{user_id}",
        "scheduled_at": f"gte.{now.isoformat()}",
        "order": "scheduled_at.asc",
        "limit": 1000,
    })
    out = []
    for r in rows or []:
        try:
            ts = datetime.fromisoformat(r["scheduled_at"].replace("Z","+00:00"))
        except Exception:
            continue
        if ts <= horizon and not (r.get("reminder_sent") is True):
            out.append(r)
    return out

def _user_profile(user_id: str) -> Dict[str, Any]:
    rows, _ = _get_sync("/rest/v1/users_public", {
        "select":"user_id,email,handle",
        "user_id": f"eq.{user_id}",
        "limit": 1
    })
    return rows[0] if rows else {}

@router.post("/remind/self")
def remind_self(authorization: Optional[str] = Header(None), hours: int = 24):
    user = _require_user(authorization)
    uid = user["id"]
    prof = _user_profile(uid)
    if not prof.get("email"):
        # nothing to do
        return {"ok": True, "sent": 0, "reason": "no-email"}

    slots = _upcoming_slots_for_user(uid, hours=hours)
    if not slots:
        return {"ok": True, "sent": 0}

    # Build a simple text email
    lines = ["Deine anstehenden Posts (nächste 24h):", ""]
    for s in slots:
        lines.append(f"- {s['platform']} @ {s['scheduled_at']}  {('— '+s['note']) if s.get('note') else ''}")
    text = "\n".join(lines)

    _send_mail(prof["email"], "Reminder: Geplante Posts", text)

    # mark as reminded
    for s in slots:
        update_sync("/rest/v1/planner_slots", {"reminder_sent": True}, eq={"id": s["id"]})
    return {"ok": True, "sent": len(slots)}

@router.post("/planner/remind_all")
def remind_all(x_cron_secret: Optional[str] = Header(None), hours: int = 24):
    if not CRON_SECRET or x_cron_secret != CRON_SECRET:
        raise HTTPException(403, "forbidden")
    # load recent users (last 1000 created)
    users, _ = _get_sync("/rest/v1/users_public", {
        "select":"user_id,email",
        "order":"created_at.desc",
        "limit": 1000
    })
    total_sent = 0
    for u in users or []:
        uid = u["user_id"]
        email = u.get("email")
        if not email:
            continue
        slots = _upcoming_slots_for_user(uid, hours=hours)
        if not slots:
            continue
        lines = ["Deine anstehenden Posts (nächste 24h):", ""]
        for s in slots:
            lines.append(f"- {s['platform']} @ {s['scheduled_at']}  {('— '+s['note']) if s.get('note') else ''}")
        text = "\n".join(lines)
        try:
            _send_mail(email, "Reminder: Geplante Posts", text)
            for s in slots:
                update_sync("/rest/v1/planner_slots", {"reminder_sent": True}, eq={"id": s["id"]})
            total_sent += len(slots)
        except Exception:
            # continue with others
            pass
    return {"ok": True, "sent": total_sent}
