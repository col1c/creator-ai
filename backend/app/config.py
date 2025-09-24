import os
from pydantic import BaseModel

class Settings(BaseModel):
    ENV: str = os.getenv("ENV", "prod")
    SUPABASE_URL: str | None = os.getenv("SUPABASE_URL")
    SUPABASE_SERVICE_ROLE: str | None = os.getenv("SUPABASE_SERVICE_ROLE")
    SUPABASE_ANON_KEY: str | None = os.getenv("SUPABASE_ANON_KEY")
    CORS_ORIGINS: str = os.getenv("CORS_ORIGINS", "http://localhost:5173")
    CORS_ORIGIN_REGEX: str = os.getenv("CORS_ORIGIN_REGEX", r"https://.*\.vercel\.app$")

settings = Settings()
