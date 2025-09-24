from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, field_validator
from .gen import generate
import os
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Creator AI Backend", version="0.1.0")

# CORS (lokal + Vercel)
origins = os.getenv("CORS_ORIGINS", "http://localhost:5173,https://*.vercel.app").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in origins],
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

@app.post("/api/v1/generate")
def api_generate(payload: GenerateIn):
    try:
        result = generate(payload.type, payload.topic.strip(), payload.niche.strip(), payload.tone.strip())
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
