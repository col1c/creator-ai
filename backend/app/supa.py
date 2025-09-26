import os, httpx
from datetime import datetime, timezone, timedelta
from .config import settings


SUPABASE_URL = settings.SUPABASE_URL
SERVICE_ROLE = settings.SUPABASE_SERVICE_ROLE
ANON_KEY = os.getenv("SUPABASE_ANON_KEY")  # optional


def get_upcoming_slots(hours_ahead: int = 26) -> list[dict]:
    start = datetime.now(timezone.utc)
    end = start + timedelta(hours=hours_ahead)
    url = (
        f"{SUPABASE_URL}/rest/v1/planner_slots"
        f"?reminder_sent=is.false"
        f"&scheduled_at=gte.{start.isoformat()}"
        f"&scheduled_at=lt.{end.isoformat()}"
        # Embed E-Mail aus users_public
        f"&select=id,user_id,platform,scheduled_at,note,users_public(email)"
        f"&order=scheduled_at.asc"
    )
    with httpx.Client(timeout=15.0) as c:
        r = c.get(url, headers=_admin_headers())
        r.raise_for_status()
        return r.json()  # [{..., "users_public": {"email": "..."}}, ...]

def mark_reminded(slot_id: int):
    url = f"{SUPABASE_URL}/rest/v1/planner_slots?id=eq.{slot_id}"
    with httpx.Client(timeout=10.0) as c:
        r = c.patch(url, headers=_admin_headers(), json={"reminder_sent": True})
        r.raise_for_status()

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
        "apikey": ANON_KEY or SERVICE_ROLE or "",  # <— HIER der entscheidende Header
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

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SERVICE_ROLE = os.environ["SUPABASE_SERVICE_ROLE"]

def _headers():
    return {
        "apikey": SERVICE_ROLE,
        "Authorization": f"Bearer {SERVICE_ROLE}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }

async def cache_get_by_key(cache_key: str, user_id: str):
    url = f"{SUPABASE_URL}/rest/v1/prompt_cache"
    params = {
        "cache_key": f"eq.{cache_key}",
        "user_id": f"eq.{user_id}",
        "limit": 1
    }
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(url, headers=_headers(), params=params)
        r.raise_for_status()
        items = r.json()
        return items[0] if items else None

async def cache_insert(entry: dict):
    url = f"{SUPABASE_URL}/rest/v1/prompt_cache"
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(url, headers=_headers(), json=entry)
        r.raise_for_status()
        return r.json()[0] if r.text else None

async def log_usage(user_id: str, event: str, meta: dict | None = None):
    url = f"{SUPABASE_URL}/rest/v1/usage_log"
    payload = {"user_id": user_id, "event": event, "meta": meta or {}}
    async with httpx.AsyncClient(timeout=5) as client:
        try:
            await client.post(url, headers=_headers(), json=payload)
        except Exception:
            # Logging darf nie den Request sprengen
            pass
    return True