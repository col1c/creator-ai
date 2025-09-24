import os, httpx
from datetime import datetime, timezone
from .config import settings

SUPABASE_URL = settings.SUPABASE_URL
SERVICE_ROLE = settings.SUPABASE_SERVICE_ROLE


def _admin_headers():
    if not SUPABASE_URL or not SERVICE_ROLE:
        raise RuntimeError("Supabase Service Role nicht gesetzt")
    return {
        "apikey": SERVICE_ROLE,
        "Authorization": f"Bearer {SERVICE_ROLE}",
        "Content-Type": "application/json",
    }

def get_user_from_token(access_token: str) -> dict | None:
    """
    Liest den User aus Supabase Auth. Wichtig: 'apikey' MUSS gesetzt sein
    (anon ODER service role), sonst kommt 401/403 -> user=None.
    """
    if not access_token or not SUPABASE_URL:
        return None
    url = f"{SUPABASE_URL}/auth/v1/user"
    headers = {
        "Authorization": f"Bearer {access_token}",
    }
    try:
        with httpx.Client(timeout=10.0) as c:
            r = c.get(url, headers=headers)
            if r.status_code == 200:
                return r.json()
            # Optionales Debug-Logging (kurz halten)
            # print("auth user fail", r.status_code, r.text[:200])
    except Exception:
        pass
    return None

def month_start_utc(now: datetime | None = None) -> str:
    if not now: now = datetime.now(timezone.utc)
    start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
    return start.isoformat()

def get_profile(user_id: str) -> dict:
    url = f"{SUPABASE_URL}/rest/v1/users_public?select=monthly_credit_limit&user_id=eq.{user_id}"
    with httpx.Client(timeout=12.0) as c:
        r = c.get(url, headers=_admin_headers())
        r.raise_for_status()
        rows = r.json()
        if rows: return rows[0]
    return {"monthly_credit_limit": 50}

def count_generates_this_month(user_id: str) -> int:
    start = month_start_utc()
    url = (f"{SUPABASE_URL}/rest/v1/usage_log"
           f"?user_id=eq.{user_id}&event=eq.generate&created_at=gte.{start}&select=id")
    with httpx.Client(timeout=12.0) as c:
        r = c.get(url, headers=_admin_headers())
        r.raise_for_status()
        return len(r.json())

def log_usage(user_id: str, event: str, meta: dict | None = None):
    url = f"{SUPABASE_URL}/rest/v1/usage_log"
    payload = {"user_id": user_id, "event": event, "meta": meta or {}}
    with httpx.Client(timeout=12.0) as c:
        r = c.post(url, headers=_admin_headers(), json=payload)
        r.raise_for_status()

def get_profile_full(user_id: str) -> dict:
    url = f"{SUPABASE_URL}/rest/v1/users_public?select=handle,niche,target,brand_voice,monthly_credit_limit&user_id=eq.{user_id}"
    with httpx.Client(timeout=10.0) as c:
        r = c.get(url, headers=_admin_headers())
        r.raise_for_status()
        rows = r.json()
    return rows[0] if rows else {"brand_voice": {}, "monthly_credit_limit": 50}
