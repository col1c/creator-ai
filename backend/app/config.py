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
    LLM_REASONING: str = os.getenv("LLM_REASONING", "off")  # "on"|"off"
    LLM_JSON_MODE: str = os.getenv("LLM_JSON_MODE", "on")   # "on"|"off"

    CRON_SECRET: str | None = os.getenv("CRON_SECRET")      # schützt /planner/remind
    MAIL_FROM: str = os.getenv("DAILY_EMAIL_FROM", "noreply@example.com")
    MAILGUN_REGION: str = os.getenv("MAILGUN_REGION", "eu")  # "us" | "eu"

settings = Settings()
