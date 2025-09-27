# backend/app/config.py  (PATCH)
from pydantic import BaseModel
import os

class Settings(BaseModel):
    ENV: str = os.getenv("ENV", "local")

    SUPABASE_URL: str | None = os.getenv("SUPABASE_URL")
    SUPABASE_SERVICE_ROLE: str | None = os.getenv("SUPABASE_SERVICE_ROLE")

    MAILGUN_API_KEY: str | None = os.getenv("MAILGUN_API_KEY")
    MAILGUN_DOMAIN: str | None = os.getenv("MAILGUN_DOMAIN")

    # OpenRouter / LLM
    OPENROUTER_API_KEY: str | None = os.getenv("OPENROUTER_API_KEY")
    OPENROUTER_MODEL: str = os.getenv("OPENROUTER_MODEL", "x-ai/grok-4-fast:free")
    OPENROUTER_SITE_URL: str | None = os.getenv("OPENROUTER_SITE_URL")
    OPENROUTER_APP_TITLE: str = os.getenv("OPENROUTER_APP_TITLE", "Creator AI")
    LLM_REASONING: str = os.getenv("LLM_REASONING", "off")   # "on"|"off"
    LLM_JSON_MODE: str = os.getenv("LLM_JSON_MODE", "on")    # "on"|"off"

    CRON_SECRET: str | None = os.getenv("CRON_SECRET")       # schützt /planner/remind
    MAIL_FROM: str = os.getenv("DAILY_EMAIL_FROM", "noreply@example.com")
    MAILGUN_REGION: str = os.getenv("MAILGUN_REGION", "eu")  # "us" | "eu"

    # --- CORS / Origins ----------------------------------------------------  # NEU
    VERCEL_ORIGIN: str | None = os.getenv("VERCEL_ORIGIN")
    CORS_EXTRA_ORIGINS: str | None = os.getenv("CORS_EXTRA_ORIGINS")  # CSV
    DEV_ORIGINS: str = os.getenv("DEV_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")

    def cors_allowed_origins(self) -> list[str]:  # NEU
        origins: list[str] = []
        if self.VERCEL_ORIGIN:
            origins.append(self.VERCEL_ORIGIN)
        # optional: auch die öffentlich sichtbare Site-URL whitelisten
        if self.OPENROUTER_SITE_URL:
            origins.append(self.OPENROUTER_SITE_URL)
        if self.CORS_EXTRA_ORIGINS:
            origins += [o.strip() for o in self.CORS_EXTRA_ORIGINS.split(",") if o.strip()]
        if self.ENV.lower() in ("local", "dev", "development"):
            origins += [o.strip() for o in self.DEV_ORIGINS.split(",") if o.strip()]
        # de-dupe & Fallback
        out: list[str] = []
        for o in origins:
            if o and o not in out:
                out.append(o)
        return out or ["http://localhost:5173"]

settings = Settings()

# ÄNDERUNG: unten anhängen
STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "")
STRIPE_PRICE_PRO = os.getenv("STRIPE_PRICE_PRO", "")      # z.B. price_123
STRIPE_PRICE_TEAM = os.getenv("STRIPE_PRICE_TEAM", "")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")
FRONTEND_BASE_URL = os.getenv("FRONTEND_BASE_URL", "https://your-frontend.example.com")

TURNSTILE_SECRET = os.getenv("TURNSTILE_SECRET", "")      # Cloudflare Turnstile
INVITE_REQUIRED = os.getenv("INVITE_REQUIRED", "false").lower() == "true"
