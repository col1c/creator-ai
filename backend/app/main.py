import os
from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel, field_validator
from .gen import generate
from .supa import get_user_from_token, get_profile, count_generates_this_month, log_usage, month_start_utc


app = FastAPI(title="Creator AI Backend", version="0.2.1")

# EXAKTE Origins + Regex für alle vercel.app-Subdomains
origins_env = os.getenv("CORS_ORIGINS", "http://localhost:5173")
origin_regex = os.getenv("CORS_ORIGIN_REGEX", r"https://.*\.vercel\.app$")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in origins_env.split(",") if o.strip()],
    allow_origin_regex=origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
    return {"ok": True}

@app.get("/api/v1/credits")
def get_credits(authorization: str | None = Header(default=None)):
    """
    Liefert Monats-Limit, bisherige Nutzung und Rest.
    Erwartet: Authorization: Bearer <supabase_access_token>
    """
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()

    user = get_user_from_token(token) if token else None
    if not user:
        # Ohne Login keine persönlichen Credits
        return {"limit": 0, "used": 0, "remaining": 0, "period": {"from": month_start_utc(), "to": None}, "authenticated": False}

    user_id = user.get("id")
    prof = get_profile(user_id)
    limit = int(prof.get("monthly_credit_limit", 50))
    used = count_generates_this_month(user_id)
    remaining = max(0, limit - used)
    return {
        "limit": limit,
        "used": used,
        "remaining": remaining,
        "period": {"from": month_start_utc(), "to": None},
        "authenticated": True,
        "user": {"id": user_id, "email": user.get("email")}
    }

@app.post("/api/v1/generate")
def api_generate(payload: GenerateIn, authorization: str | None = Header(default=None)):
    # Optional: Supabase-Auth → Credits prüfen
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
            raise HTTPException(status_code=429, detail="Monatslimit erreicht. Upgrade oder nächsten Monat weiter nutzen.")
        # Logge die Nutzung VOR der Ausgabe
        try:
            log_usage(user_id, "generate", {"type": payload.type})
        except Exception:
            pass  # fail-open für MVP

    try:
        result = generate(payload.type, payload.topic.strip(), payload.niche.strip(), payload.tone.strip())
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
