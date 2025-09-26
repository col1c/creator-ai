# app/supa.py
# Zweck: Einheitlicher, rein async Supabase-Client (REST) + Helpers.
# Warum: Vermeidet doppelte sync/async-Funktionen und Blocking im Event-Loop.

from __future__ import annotations
import os
import httpx
from typing import Any, Dict, Optional

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SERVICE_ROLE = os.environ["SUPABASE_SERVICE_ROLE"]

DEFAULT_TIMEOUT = httpx.Timeout(15.0, read=15.0, write=15.0, connect=10.0)

def _headers() -> Dict[str, str]:
    return {
        "apikey": SERVICE_ROLE,
        "Authorization": f"Bearer {SERVICE_ROLE}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }

async def _get(path: str, params: Optional[Dict[str, Any]] = None):
    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        r = await client.get(f"{SUPABASE_URL}{path}", headers=_headers(), params=params)
        r.raise_for_status()
        return r.json()

async def _post(path: str, json: Dict[str, Any]):
    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        r = await client.post(f"{SUPABASE_URL}{path}", headers=_headers(), json=json)
        r.raise_for_status()
        return r.json() if r.text else None

# ---------- Auth / User ----------

async def get_user_from_token(access_token: str) -> Dict[str, Any]:
    """Liest den Auth-User (auth.user) anhand eines Supabase-Access-Tokens."""
    headers = {
        "apikey": SERVICE_ROLE,
        "Authorization": f"Bearer {access_token}",
    }
    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        r = await client.get(f"{SUPABASE_URL}/auth/v1/user", headers=headers)
        r.raise_for_status()
        return r.json()

# ---------- Usage-Log ----------

async def log_usage(user_id: str, event: str, meta: Optional[Dict[str, Any]] = None) -> bool:
    try:
        await _post("/rest/v1/usage_log", {"user_id": user_id, "event": event, "meta": meta or {}})
    except Exception:
        # Logging darf nie Business-Flow killen
        return False
    return True

# ---------- Prompt-Cache ----------

async def cache_get_by_key(cache_key: str, user_id: str) -> Optional[Dict[str, Any]]:
    items = await _get("/rest/v1/prompt_cache", {
        "cache_key": f"eq.{cache_key}",
        "user_id": f"eq.{user_id}",
        "limit": 1,
    })
    return items[0] if items else None

async def cache_insert(entry: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    return await _post("/rest/v1/prompt_cache", entry)

# ---------- Users Public ----------

async def upsert_users_public(row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    # Nutzt 'user_id' als PK (insert conflict handled RLS-seitig)
    return await _post("/rest/v1/users_public", row)

# ---------- Generations (Convenience) ----------

async def insert_generation(row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    return await _post("/rest/v1/generations", row)
