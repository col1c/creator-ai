# NEU: Cloudflare Turnstile Verify
from fastapi import APIRouter, HTTPException
import httpx, os
from .config import TURNSTILE_SECRET

router = APIRouter(prefix="/api/v1/captcha", tags=["captcha"])

TURNSTILE_VERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

@router.post("/verify")
async def verify_captcha(token: dict):
    if not TURNSTILE_SECRET:
        # Wenn kein Secret konfiguriert, im DEV einfach bestehen lassen
        return {"ok": True, "dev": True}
    user_token = token.get("token")
    if not user_token:
        raise HTTPException(400, "missing token")
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.post(TURNSTILE_VERIFY, data={"secret": TURNSTILE_SECRET, "response": user_token})
        r.raise_for_status()
        data = r.json()
    if not data.get("success"):
        raise HTTPException(400, "captcha failed")
    return {"ok": True}
