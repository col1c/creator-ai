# app/main.py
from datetime import datetime, timezone
from typing import Literal

from fastapi import FastAPI, HTTPException, Header, Response, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator

from .config import settings
from .gen import generate
from .llm_openrouter import call_openrouter
from .supa import (
    get_user_from_token,
    get_profile,
    get_profile_full,        # Brand-Voice
    count_generates_this_month,
    log_usage,
    month_start_utc,
)

app = FastAPI(title="Creator AI Backend", version="0.3.6")

# CORS breit fürs MVP (später per ENV einschränken)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Engine"],  # wichtig fürs Frontend-Badge
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
    return {"ok": True, "version": "0.3.6"}

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

# ---- POST Generate (Brand-Voice + Credits + LLM-Switch) ----
@app.post("/api/v1/generate")
def api_generate(payload: GenerateIn, authorization: str | None = Header(default=None), response: Response | None = None):
    # --- Auth + Credits defensiv ---
    user_id = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        try:
            user = get_user_from_token(token) or {}
            user_id = user.get("id")
        except Exception:
            user_id = None

    limit, used = 50, 0
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
            # Credits-System gestört -> fail-open mit Default-Limit
            limit, used = 50, 0

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
            variants = call_openrouter(
                payload.type,
                payload.topic.strip(),
                payload.niche.strip(),
                payload.tone.strip(),
                voice,
            )
            if response is not None:
                response.headers["X-Engine"] = "llm"
            return {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "type": payload.type,
                "variants": variants,
                "engine": "llm",
            }
        except Exception:
            # Silent fallthrough → lokaler Generator
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
        if response is not None:
            response.headers["X-Engine"] = "local"
        result["engine"] = "local"
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

# ---- GET-Fallback ohne Body/Token (debug; zieht KEINE Credits) ----
@app.get("/api/v1/generate_simple")
def api_generate_simple(
    type: str = Query(..., pattern="^(hook|script|caption|hashtags)$"),
    topic: str = Query(..., min_length=2),
    niche: str = Query("allgemein"),
    tone: str = Query("locker"),
    response: Response | None = None,
):
    try:
        result = generate(type, topic.strip(), niche.strip(), tone.strip())
        if response is not None:
            response.headers["X-Engine"] = "local"
        result["engine"] = "local"
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
