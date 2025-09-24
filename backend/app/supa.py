import os, httpx
from datetime import datetime, timezone

SUPABASE_URL = os.getenv("SUPABASE_URL")
SERVICE_ROLE = os.getenv("SUPABASE_SERVICE_ROLE")

def _admin_headers():
    if not SUPABASE_URL or not SERVICE_ROLE:
        raise RuntimeError("Supabase Service Role nicht gesetzt")
    return {
        "apikey": SERVICE_ROLE,
        "Authorization": f"Bearer {SERVICE_ROLE}",
        "Content-Type": "application/json",
    }

def get_user_from_token(access_token: str) -> dict | None:
    # Prüft Supabase-Access-Token → liefert User (id,email)
    if not access_token: return None
    url = f"{SUPABASE_URL}/auth/v1/user"
    try:
        with httpx.Client(timeout=10.0) as c:
            r = c.get(url, headers={"Authorization": f"Bearer {access_token}"})
            if r.status_code == 200:
                return r.json()
    except Exception:
        pass
    return None

def get_profile(user_id: str) -> dict:
    # users_public lesen (monthly_credit_limit)
    url = f"{SUPABASE_URL}/rest/v1/users_public?select=monthly_credit_limit&user_id=eq.{user_id}"
    with httpx.Client(timeout=10.0) as c:
        r = c.get(url, headers=_admin_headers())
        r.raise_for_status()
        rows = r.json()
    if rows:
        return rows[0]
    # Fallback: Default-Limit
    return {"monthly_credit_limit": 50}

def month_start_utc(now: datetime | None = None) -> str:
    if not now: now = datetime.now(timezone.utc)
    start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
    return start.isoformat()

def count_generates_this_month(user_id: str) -> int:
    # usage_log: event='generate' seit Monatsanfang
    start = month_start_utc()
    url = (f"{SUPABASE_URL}/rest/v1/usage_log"
           f"?user_id=eq.{user_id}&event=eq.generate&created_at=gte.{start}&select=id")
    with httpx.Client(timeout=10.0) as c:
        r = c.get(url, headers=_admin_headers())
        r.raise_for_status()
        rows = r.json()
    return len(rows)

def log_usage(user_id: str, event: str, meta: dict | None = None):
    url = f"{SUPABASE_URL}/rest/v1/usage_log"
    payload = {"user_id": user_id, "event": event, "meta": meta or {}}
    with httpx.Client(timeout=10.0) as c:
        r = c.post(url, headers=_admin_headers(), json=payload)
        r.raise_for_status()
