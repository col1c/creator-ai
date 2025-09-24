import os
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator

from .config import settings
from .gen import generate
from .supa import (
    get_user_from_token, get_profile,
    count_generates_this_month, log_usage, month_start_utc
)

app = FastAPI(title="Creator AI Backend", version="0.3.0")

# --- CORS robust (konkrete Origins + Regex für vercel.app) ---
origins_list = [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins_list,                     # z.B. http://localhost:5173
    allow_origin_regex=settings.CORS_ORIGIN_REGEX, # alle *.vercel.app
    allow_credentials=False,                        # Cookies nicht nötig
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["authorization", "content-type", "accept", "x-requested-with"],
    expose_headers=[],
    max_age=86400,
)

class GenerateIn(BaseModel):
    type: str
    topic: str
    niche: str = "allgemein"
    tone: str = "locker"

    @field_validator("type")
    @classmethod
    def valid_type(cls, v):
        allowed = {"hook","script","caption","hashtags"}
        if v not in allowed:
            raise ValueError(f"type must be one of {allowed}")
        return v

@app.get("/health")
def health():
    return {"ok": True, "env": settings.ENV}

@app.get("/api/v1/credits")
def get_credits(authorization: str | None = Header(default=None)):
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()

    user = get_user_from_token(token) if token else None
    if not user:
        # kein Login → kein persönliches Kontingent
        return {
            "limit": 0, "used": 0, "remaining": 0,
            "period": {"from": month_start_utc(), "to": None},
            "authenticated": False
        }

    user_id = user.get("id")
    prof = get_profile(user_id)
    limit = int(prof.get("monthly_credit_limit", 50))
    used = count_generates_this_month(user_id)
    return {
        "limit": limit,
        "used": used,
        "remaining": max(0, limit - used),
        "period": {"from": month_start_utc(), "to": None},
        "authenticated": True,
        "user": {"id": user_id, "email": user.get("email")}
    }

@app.post("/api/v1/generate")
def api_generate(payload: GenerateIn, authorization: str | None = Header(default=None)):
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()

    user = get_user_from_token(token) if token else None
    user_id = user.get("id") if user else None

    if user_id:
        prof = get_profile(user_id)
        limit = int(prof.get("monthly_credit_limit", 50))
        used = count_generates_this_month(user_id)
        if used >= limit:
            raise HTTPException(status_code=429, detail="Monatslimit erreicht.")
        try:
            log_usage(user_id, "generate", {"type": payload.type})
        except Exception:
            # fail-open im MVP
            pass

    try:
        return generate(payload.type, payload.topic.strip(), payload.niche.strip(), payload.tone.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
