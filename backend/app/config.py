from pydantic import BaseModel
import os

class Settings(BaseModel):
    ENV: str = os.getenv("ENV", "local")
    SUPABASE_URL: str | None = os.getenv("SUPABASE_URL")
    SUPABASE_SERVICE_ROLE: str | None = os.getenv("SUPABASE_SERVICE_ROLE")
    MAILGUN_API_KEY: str | None = os.getenv("MAILGUN_API_KEY")
    MAILGUN_DOMAIN: str | None = os.getenv("MAILGUN_DOMAIN")

settings = Settings()
