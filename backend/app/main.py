from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, field_validator
from .gen import generate
import os
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Creator AI Backend", version="0.1.0")

# CORS (lokal + Vercel)
app = FastAPI(title="Creator AI Backend", version="0.1.0")

allowed_origins = ["http://localhost:5173"]
vercel = os.getenv("VERCEL_ORIGIN", "").strip()  # z.B. https://creator-ai-vert.vercel.app
if vercel:
    allowed_origins.append(vercel)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"^https://.*\.vercel\.app$",
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
