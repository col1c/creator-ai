# app/main.py
from datetime import datetime, timezone, timedelta
from typing import Literal, Optional
import os
import logging

from fastapi import FastAPI, HTTPException, Header, Response, Query, Request, Path, APIRouter
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator

# Interne Module
from . import supa
from .reminder import router as reminder_router
from .analytics import router as analytics_router  # NEU
from .mailer import send_mail
from .config import settings
from .supa import get_upcoming_slots, mark_reminded
from .llm_openrouter import call_openrouter_retry
from .gen import generate as generate_local

# Sync helpers (bestehend)
from .supa import (
    get_user_from_token,
    get_profile,
    get_profile_full,        # Brand-Voice
    count_generates_this_month,
    month_start_utc,
)

# NEU/GEÄNDERT: Cache & async-Logging via supa + Cache-Key-Helper
from .cache import make_cache_key, normalize_payload
from .ratelimit import check_allow  # Rate limit helper


app = FastAPI(title="Creator AI Backend", version="0.4.0")

# Router aus Modulen einhängen
app.include_router(analytics_router)              # NEU
app.include_router(reminder_router)

# ---------------- CORS (gehärtet) ----------------
_allowed = settings.cors_allowed_origins()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Cron-Secret", "X-Requested-With"],
    expose_headers=[
        "X-Engine",
        "X-Cache",
        "X-RateLimit-Limit",
        "X-RateLimit-Remaining",
    ],
    max_age=600,
)

# ------------- Startup-Report (nur Logs) -------------
logger = logging.getLogger("uvicorn.error")

@app.on_event("startup")
def _startup_env_report():
    feats = {
        "llm": bool(settings.OPENROUTER_API_KEY),
        "mail": bool(settings.MAILGUN_API_KEY and settings.MAILGUN_DOMAIN),
        "cron": bool(settings.CRON_SECRET),
    }
    missing = []
    if not settings.SUPABASE_URL: missing.append("SUPABASE_URL")
    if not settings.SUPABASE_SERVICE_ROLE: missing.append("SUPABASE_SERVICE_ROLE")

    logger.info("[startup] ENV=%s", settings.ENV)
    logger.info("[startup] CORS allow_origins=%s", settings.cors_allowed_origins())
    logger.info("[startup] features=%s", feats)
    if missing:
        logger.warning("[startup] Missing critical envs: %s", ", ".join(missing))

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
    return {"ok": True, "version": "0.4.0"}


# ---- kleiner Helper für Rate-Limit ----
def _rate_limit_or_429(request: Request, user_id: Optional[str]):
    key = user_id or (request.client.host if request.client else "anon")
    ok, _lim, _used = check_allow(key)
    if not ok:
        raise HTTPException(status_code=429, detail="Zu viele Anfragen. Warte kurz.")


# ---- Credits (mit Fallback 50) ----
@app.get("/api/v1/credits")
async def get_credits(authorization: str | None = Header(default=None)):
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
    prof = get_profile(user_id) or {}

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


def _choose_output_from_variants(variants) -> str:
    """
    Nimmt die beste Variante (erste nicht-leere). Fallback: join mit newline.
    """
    if isinstance(variants, list):
        for v in variants:
            if isinstance(v, str) and v.strip():
                return v.strip()
        return "\n".join([str(v) for v in variants if v])
    if isinstance(variants, str):
        return variants.strip()
    return str(variants)


# ---- POST Generate (Brand-Voice + Credits + LLM-Switch + Rate-Limit + CACHE) ----
@app.post("/api/v1/generate")
async def api_generate(
    payload: GenerateIn,
    response: Response,
    request: Request,
    authorization: str | None = Header(default=None),
    force: str | None = Query(default=None, description="Cache ignorieren (1/true/yes)"),
):
    # Rate-limit (vor Auth)
    _rate_limit_or_429(request, None)
    response.headers["X-RateLimit-Limit"] = str(int(os.getenv("RATE_LIMIT_PER_MIN", "60")))

    # --- Auth + Credits defensiv ---
    user_id: Optional[str] = None
    user = None
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

    # --- Credits vorberechnen (nur für Header/UX)
    limit = 50
    used = 0
    if user_id:
        try:
            prof = get_profile(user_id) or {}
            limit = int(prof.get("monthly_credit_limit") or 50)
            if limit <= 0:
                limit = 50
            used = count_generates_this_month(user_id)
        except Exception:
            pass

    # --- Brand-Voice defensiv ---
    voice = None
    if user_id:
        try:
            full = get_profile_full(user_id) or {}
            voice = full.get("brand_voice") or {}
            if isinstance(voice, dict) and voice.get("tone"):
                payload.tone = (voice.get("tone") or payload.tone or "").strip()
        except Exception:
            voice = None

    # --- Cache prüfen ---
    force_bypass = str(force or "").lower() in ("1", "true", "yes")
    cache_key = make_cache_key(user_id or "anon", payload.type, payload.model_dump())
    if user_id and not force_bypass:
        hit = await supa.cache_get_by_key(cache_key, user_id)
        if hit:
            # Cache-Hit zählt NICHT gegen Credits
            await supa.log_usage(user_id, "generate_cache_hit", {"type": payload.type, "cache_key": cache_key})
            response.headers["X-Cache"] = "HIT"
            response.headers["X-Engine"] = hit.get("model") or "cache"
            # Remaining bleibt unverändert
            response.headers["X-RateLimit-Remaining"] = str(max(0, limit - used))
            return JSONResponse(
                {
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                    "type": payload.type,
                    "output": hit["output"],
                    "engine": "cache",
                    "cached": True,
                }
            )

    # --- Engine-Switch bestimmen ---
    mode = (payload.engine or "auto").lower()
    use_llm = (mode == "llm") or (mode == "auto" and bool(settings.OPENROUTER_API_KEY))
    output_text: Optional[str] = None
    engine_used = "local"
    model_name = None
    tokens_in = None
    tokens_out = None

    # --- LLM zuerst (wenn konfiguriert / erlaubt) ---
    if use_llm:
        try:
            variants = call_openrouter_retry(
                payload.type,
                payload.topic.strip(),
                payload.niche.strip(),
                payload.tone.strip(),
                voice,
            )
            output_text = _choose_output_from_variants(variants)
            engine_used = "llm"
            model_name = getattr(settings, "OPENROUTER_MODEL", None) or "llm"
        except Exception:
            # Silent fallthrough → local
            output_text = None

    # --- Lokaler Fallback (kostenlos) ---
    if output_text is None:
        try:
            local = generate_local(
                payload.type,
                payload.topic.strip(),
                payload.niche.strip(),
                payload.tone.strip(),
                voice,
            )
            # local kann {output} oder {variants} liefern
            if isinstance(local, dict) and "output" in local:
                output_text = str(local["output"]).strip()
            elif isinstance(local, dict) and "variants" in local:
                output_text = _choose_output_from_variants(local["variants"])
            else:
                output_text = _choose_output_from_variants(local)
            engine_used = "local"
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    if not output_text:
        raise HTTPException(status_code=500, detail="Generation failed")

    # --- Cache speichern (nur wenn User bekannt) ---
    if user_id:
        try:
            await supa.cache_insert({
                "cache_key": cache_key,
                "user_id": user_id,
                "type": payload.type,
                "payload": normalize_payload(payload.model_dump()),
                "output": output_text,
                "model": model_name or engine_used,
                "tokens_in": tokens_in,
                "tokens_out": tokens_out,
            })
        except Exception:
            pass

        # Credits-Log NUR bei MISS
        try:
            await supa.log_usage(user_id, "generate", {"type": payload.type, "cache_key": cache_key})
        except Exception:
            pass

    # --- Response-Header setzen ---
    response.headers["X-Cache"] = "MISS" if user_id and not force_bypass else ("BYPASS" if force_bypass else "MISS")
    response.headers["X-Engine"] = engine_used
    # Remaining: bei MISS (mit User) theoretisch -1; wir zeigen konservativ die aktuelle Schätzung
    remaining = max(0, (limit - used) - (1 if (user_id and not force_bypass) else 0))
    response.headers["X-RateLimit-Remaining"] = str(remaining)

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "type": payload.type,
        "output": output_text,
        "engine": engine_used,
        "cached": False if not force_bypass else False,
    }


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
        response.headers["X-Cache"] = "DISABLED"
    try:
        result = generate_local(type, topic.strip(), niche.strip(), tone.strip())
        # Normalisiere auf {output}
        if isinstance(result, dict) and "output" in result:
            out = str(result["output"]).strip()
        elif isinstance(result, dict) and "variants" in result:
            out = _choose_output_from_variants(result["variants"])
        else:
            out = _choose_output_from_variants(result)
        return {"generated_at": datetime.now(timezone.utc).isoformat(), "type": type, "output": out, "engine": "local"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---- Planner: E-Mail-Reminder (per CRON) ----
@app.post("/api/v1/planner/remind")
def planner_remind(request: Request, x_cron_secret: str | None = Header(default=None)):
    # Schutz
    if not settings.CRON_SECRET or x_cron_secret != settings.CRON_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")

    # NEU: wenn Mail nicht konfiguriert, freundlich abbrechen
    if not (settings.MAILGUN_API_KEY and settings.MAILGUN_DOMAIN):
        slots = get_upcoming_slots(hours_ahead=26)
        # kein sent, aber ok
        return {"ok": True, "sent": 0, "checked": int(len(slots)), "mail": "disabled"}

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

    return {"ok": True, "sent": int(sent), "checked": int(len(slots))}


# ---------------- Lokaler APIRouter (Templates + ICS) ----------------
router = APIRouter()

async def _uid_from_request(request: Request) -> str:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")
    token = auth.split(" ", 1)[1]
    user = await supa.get_user_from_token(token)
    uid = user.get("id")
    if not uid:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return uid


@router.get("/api/v1/templates")
async def list_templates(
    request: Request,
    search: Optional[str] = Query(None),
    typ: Optional[str] = Query(None, regex="^(hook|script|caption)$"),
    limit: int = Query(100, ge=1, le=200),
):
    uid = await _uid_from_request(request)
    items = await supa.templates_list(uid, search=search, typ=typ, limit=limit)
    return {"items": items}


@router.post("/api/v1/templates")
async def create_template(request: Request):
    uid = await _uid_from_request(request)
    body = await request.json()
    name = (body.get("name") or "").strip()
    typ  = body.get("type")
    prompt = body.get("prompt") or {}
    if typ not in ("hook","script","caption"):
        raise HTTPException(400, "type must be one of hook|script|caption")
    if not name:
        raise HTTPException(400, "name required")
    try:
        row = await supa.templates_create(uid, name=name, typ=typ, prompt=prompt)
        return {"item": row[0] if isinstance(row, list) and row else row}
    except Exception as e:
        raise HTTPException(400, str(e))


@router.patch("/api/v1/templates/{id}")
async def update_template(id: int = Path(...), request: Request = None):
    uid = await _uid_from_request(request)
    patch = await request.json()
    # nur erlaubte Felder
    patch = {k: v for k, v in patch.items() if k in ("name","type","prompt")}
    if "type" in patch and patch["type"] not in ("hook","script","caption"):
        raise HTTPException(400, "invalid type")
    try:
        row = await supa.templates_update(id, uid, patch)
        return {"item": row[0] if isinstance(row, list) and row else row}
    except Exception as e:
        raise HTTPException(400, str(e))


@router.delete("/api/v1/templates/{id}")
async def delete_template(id: int = Path(...), request: Request = None):
    uid = await _uid_from_request(request)
    try:
        await supa.templates_delete(id, uid)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(400, str(e))


# --- ICS / Planner Export -----------------------------------------------------
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

@router.get("/api/v1/planner/ical")           # <— WICHTIG: GET
@router.get("/api/v1/ical/planner")           # <— Alias, falls erster Pfad kollidiert
async def planner_ical(
    request: Request,
    days: int = Query(30, ge=1, le=180),
    filename: str = Query("creatorai_planner.ics")
):
    uid = await _uid_from_request(request)
    now = datetime.now(timezone.utc)
    until = now + timedelta(days=days)

    items = await supa._get(
        "/rest/v1/planner_slots",
        params={
            "user_id": f"eq.{uid}",
            "scheduled_at": f"gte.{now.isoformat()}",
            "scheduled_at2": f"lte.{until.isoformat()}",
            "order": "scheduled_at.asc",
        }
    )
    if not items:
        items = await supa._get("/rest/v1/planner_slots", params={
            "user_id": f"eq.{uid}",
            "order": "scheduled_at.asc",
        })
        if isinstance(items, list):
            items = [
                it for it in items
                if it.get("scheduled_at") and
                   now <= datetime.fromisoformat(str(it["scheduled_at"]).replace("Z","+00:00")) <= until
            ]

    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//CreatorAI//Planner//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
    ]
    for it in (items or []):
        sid = it.get("id")
        platform = (it.get("platform") or "post").title()
        note = it.get("note") or ""
        try:
            start = datetime.fromisoformat(str(it["scheduled_at"]).replace("Z","+00:00")).astimezone(timezone.utc)
        except Exception:
            continue
        end = start + timedelta(minutes=30)
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

# Router registrieren (wichtig!)
app.include_router(router)
