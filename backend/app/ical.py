# app/ical.py
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException, Request, Query, Response
from . import supa

router = APIRouter()

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

def _ics_escape(s: str) -> str:
    if not s:
        return ""
    return (
        s.replace("\\", "\\\\")
         .replace(",", "\\,")
         .replace(";", "\\;")
         .replace("\r\n", "\\n")
         .replace("\n", "\\n")
    )

def _ics_dt(dt_utc: datetime) -> str:
    return dt_utc.strftime("%Y%m%dT%H%M%SZ")

@router.get("/api/v1/ical/planner")  # GET (absichtlich anderer Pfad, keine Kollisionen)
async def planner_ical(
    request: Request,
    days: int = Query(30, ge=1, le=180),
    filename: str = Query("creatorai_planner.ics")
):
    uid = await _uid_from_request(request)

    now = datetime.now(timezone.utc)
    until = now + timedelta(days=days)

    # Slots laden (Supabase REST, sortiert)
    items = await supa._get(
        "/rest/v1/planner_slots",
        params={
            "user_id": f"eq.{uid}",
            "order": "scheduled_at.asc",
        }
    )
    items = items or []

    # Zeitraum filtern
    parsed = []
    for it in items:
        iso = it.get("scheduled_at")
        if not iso:
            continue
        try:
            dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00")).astimezone(timezone.utc)
        except Exception:
            continue
        if now <= dt <= until:
            parsed.append((it, dt))

    # ICS bauen
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//CreatorAI//Planner//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
    ]
    for it, start in parsed:
        end = start + timedelta(minutes=30)
        sid = it.get("id")
        platform = (it.get("platform") or "post").title()
        note = it.get("note") or ""
        lines.extend([
            "BEGIN:VEVENT",
            f"UID:{sid}@creator-ai",
            f"DTSTAMP:{_ics_dt(datetime.now(timezone.utc))}",
            f"DTSTART:{_ics_dt(start)}",
            f"DTEND:{_ics_dt(end)}",
            f"SUMMARY:{_ics_escape(f'{platform} – CreatorAI Planner')}",
            f"DESCRIPTION:{_ics_escape(note)}",
            "END:VEVENT",
        ])
    lines.append("END:VCALENDAR")
    body = "\r\n".join(lines) + "\r\n"

    return Response(
        content=body,
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )
