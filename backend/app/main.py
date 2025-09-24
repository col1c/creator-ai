# app/main.py
from fastapi import FastAPI, HTTPException, Header, Response, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator

from .config import settings
from .gen import generate
from .supa import (
    get_user_from_token,
    get_profile,
    get_profile_full,        # <-- für Brand-Voice
    count_generates_this_month,
    log_usage,
    month_start_utc,
)

app = FastAPI(title="Creator AI Backend", version="0.3.4")

# Breite CORS fürs MVP; später enger stellen (ENV: CORS_ORIGINS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- universal OPTIONS handler (Preflight) ----
@app.options("/{rest_of_path:path}")
def options_handler(rest_of_path: str):
    return Response(status_code=204)

class GenerateIn(BaseModel):
    type: str
    topic: str
    niche: str = "allgemein"
    tone: str = "locker"

    @field_validator("type")
    @classmethod
    def valid_type(cls, v):
        allowed = {"hook", "script", "caption", "hashtags"}
        if v not in allowed:
            raise ValueError(f"type must be one of {allowed}")
        return v

@app.get("/health")
def health():
    return {"ok": True, "version": "0.3.4"}

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

# ---- POST Generate (mit Brand-Voice & Credits) ----
@app.post("/api/v1/generate")
def api_generate(payload: GenerateIn, authorization: str | None = Header(default=None)):
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()

    user = get_user_from_token(token) if token else None
    user_id = user.get("id") if user else None

    # Credit-Check (nur wenn eingeloggt)
    if user_id:
        prof = get_profile(user_id)
        limit = int((prof.get("monthly_credit_limit") or 50))
        used = count_generates_this_month(user_id)
        if used >= limit:
            raise HTTPException(status_code=429, detail="Monatslimit erreicht.")
        try:
            log_usage(user_id, "generate", {"type": payload.type})
        except Exception:
            pass

    # >>> Brand-Voice anwenden (wie besprochen) <<<
    try:
        voice = None
        if user_id:
            full = get_profile_full(user_id)
            voice = full.get("brand_voice") or {}
            # Brand-Voice-Ton kann UI-Ton überschreiben, falls gesetzt
            if isinstance(voice, dict) and voice.get("tone"):
                payload.tone = voice["tone"]

        result = generate(
            payload.type,
            payload.topic.strip(),
            payload.niche.strip(),
            payload.tone.strip(),
            voice,  # <- neues Argument
        )
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
):
    try:
        return generate(type, topic.strip(), niche.strip(), tone.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
