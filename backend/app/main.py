# app/main.py
from datetime import datetime, timezone
from typing import Literal
import os

from fastapi import FastAPI, HTTPException, Header, Response, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator

from .mailer import send_mail
from .config import settings
from .supa import get_upcoming_slots, mark_reminded

from .llm_openrouter import call_openrouter_retry
from .gen import generate
from .supa import (
    get_user_from_token,
    get_profile,
    get_profile_full,        # Brand-Voice
    count_generates_this_month,
    log_usage,
    month_start_utc,
)
from .ratelimit import check_allow  # Rate limit helper

app = FastAPI(title="Creator AI Backend", version="0.3.8")

# CORS breit fürs MVP (später per ENV einschränken)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Engine", "X-RateLimit-Limit"],  # wichtig fürs Frontend-Badge/Debug
)

# ---- universal OPTIONS handler (Preflight) ----
@app.options("/{rest_of_path:path}")
def options_handler(rest_of_path: str):
    return Response(status_code=204)

class GenerateIn(BaseModel):
    # Engine-Switch (auto | llm | local)
    type: Literal["hook", "script", "caption", "hashtags"]
    topic: str
    niche: str = "allgemein"
    tone: str = "locker"
    engine: Literal["auto", "llm", "local"] = "auto"

    # Sanitize/Trim
    @field_validator("topic")
    @classmethod
    def topic_minlen(cls, v: str):
        v = (v or "").strip()
        if len(v) < 2:
            raise ValueError("topic too short")
        return v

    @field_validator("niche", "tone")
    @classmethod
    def trim_fields(cls, v: str):
        return (v or "").strip()

@app.get("/health")
def health():
    return {"ok": True, "version": "0.3.8"}

# ---- kleiner Helper für Rate-Limit ----
def _rate_limit_or_429(request: Request, user_id: str | None):
    key = user_id or (request.client.host if request.client else "anon")
    ok, lim, used = check_allow(key)
    if not ok:
        raise HTTPException(status_code=429, detail="Zu viele Anfragen. Warte kurz.")

# ---- Credits (mit Fallback 50) ----
@app.get("/api/v1/credits")
def get_credits(authorization: str | None = Header(default=None)):
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()

    user = get_user_from_token(token) if token else None
    if not user:
        return {
            "limit": 0, "used": 0, "remaining": 0,
            "period": {"from": month_start_utc(), "to": None},
            "authenticated": False,
        }

    user_id = user.get("id")
    prof = get_profile(user_id)

    try:
        limit_raw = prof.get("monthly_credit_limit", 50)
        limit = int(limit_raw or 50)
    except Exception:
        limit = 50
    if limit <= 0:
        limit = 50

    try:
        used = count_generates_this_month(user_id)
    except Exception:
        used = 0

    remaining = max(0, limit - used)
    return {
        "limit": limit,
        "used": used,
        "remaining": remaining,
        "period": {"from": month_start_utc(), "to": None},
        "authenticated": True,
        "user": {"id": user_id, "email": user.get("email")},
    }

# ---- POST Generate (Brand-Voice + Credits + LLM-Switch + Rate-Limit) ----
@app.post("/api/v1/generate")
def api_generate(
    payload: GenerateIn,
    response: Response,
    request: Request,
    authorization: str | None = Header(default=None),
):
    # Rate-limit (vor Auth)
    _rate_limit_or_429(request, None)
    response.headers["X-RateLimit-Limit"] = str(int(os.getenv("RATE_LIMIT_PER_MIN", "60")))

    # --- Auth + Credits defensiv ---
    user_id = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        try:
            user = get_user_from_token(token) or {}
            user_id = user.get("id")
        except Exception:
            user_id = None

    # Optional: nach Bestimmung des Users strenger limitieren
    if user_id:
        _rate_limit_or_429(request, user_id)

    if user_id:
        try:
            prof = get_profile(user_id) or {}
            limit = int(prof.get("monthly_credit_limit") or 50)
            used = count_generates_this_month(user_id)
            if used >= limit:
                raise HTTPException(status_code=429, detail="Monatslimit erreicht.")
            try:
                log_usage(user_id, "generate", {"type": payload.type})
            except Exception:
                pass
        except Exception:
            # Credits-System gestört -> fail-open
            pass

    # --- Brand-Voice defensiv ---
    voice = None
    if user_id:
        try:
            full = get_profile_full(user_id) or {}
            voice = full.get("brand_voice") or {}
            if isinstance(voice, dict) and voice.get("tone"):
                payload.tone = voice["tone"]
        except Exception:
            voice = None

    # --- Engine-Switch bestimmen ---
    mode = (payload.engine or "auto").lower()
    use_llm = False
    if mode == "local":
        use_llm = False
    elif mode == "llm":
        use_llm = bool(settings.OPENROUTER_API_KEY)
    else:  # auto
        use_llm = bool(settings.OPENROUTER_API_KEY)

    # --- LLM zuerst (wenn konfiguriert / erlaubt) ---
    if use_llm:
        try:
            variants = call_openrouter_retry(
                payload.type, payload.topic.strip(), payload.niche.strip(), payload.tone.strip(), voice
            )
            response.headers["X-Engine"] = "llm"
            return {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "type": payload.type,
                "variants": variants,
                "engine": "llm",
            }
        except Exception:
            # Silent fallthrough → local
            pass

    # --- Lokaler Fallback (kostenlos) ---
    try:
        result = generate(
            payload.type,
            payload.topic.strip(),
            payload.niche.strip(),
            payload.tone.strip(),
            voice,
        )
        response.headers["X-Engine"] = "local"
        result["engine"] = "local"
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

# ---- GET-Fallback (debug; KEINE Credits) + Rate-Limit ----
@app.get("/api/v1/generate_simple")
def api_generate_simple(
    type: str = Query(..., pattern="^(hook|script|caption|hashtags)$"),
    topic: str = Query(..., min_length=2),
    niche: str = Query("allgemein"),
    tone: str = Query("locker"),
    response: Response = None,   # wird von FastAPI injiziert
    request: Request = None,     # wird von FastAPI injiziert
):
    # Hinweis: FastAPI injiziert Response/Request auch mit Default-Werten.
    _rate_limit_or_429(request, None)
    if response is not None:
        response.headers["X-RateLimit-Limit"] = str(int(os.getenv("RATE_LIMIT_PER_MIN", "60")))
        response.headers["X-Engine"] = "local"
    try:
        result = generate(type, topic.strip(), niche.strip(), tone.strip())
        result["engine"] = "local"
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

# ---- Planner: E-Mail-Reminder (per CRON) ----
@app.post("/api/v1/planner/remind")
def planner_remind(request: Request, x_cron_secret: str | None = Header(default=None)):
    # Schutz
    if not settings.CRON_SECRET or x_cron_secret != settings.CRON_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")

    # Ladet Slots der nächsten ~24-26h
    slots = get_upcoming_slots(hours_ahead=26)
    sent = 0
    for s in slots:
        email = (s.get("users_public") or {}).get("email")
        if not email:
            continue
        dt = s.get("scheduled_at")
        platform = s.get("platform")
        note = s.get("note") or ""
        subject = f"Reminder: {platform} Post um {dt}"
        text = (
            f"Hi!\n\n"
            f"Erinnerung: Du hast einen geplanten {platform}-Post um {dt} (UTC).\n"
            f"Notiz: {note}\n\n"
            f"Viel Erfolg! 👌"
        )
        try:
            send_mail(email, subject, text)
            mark_reminded(int(s["id"]))
            sent += 1
        except Exception:
            # weicher Fehler: skip
            pass

    return {"ok": True, "sent": sent, "checked": len(slots)}
