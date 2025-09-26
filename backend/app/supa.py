# app/supa.py
# Zweck: Einheitlicher, rein async Supabase-Client (REST) + Helpers.
# Warum: Vermeidet doppelte sync/async-Funktionen und Blocking im Event-Loop.

from __future__ import annotations
import os
import httpx
from typing import Any, Dict, Optional
from typing import List
from datetime import datetime, timezone, timedelta


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

async def templates_list(user_id: str, search: str | None = None, typ: str | None = None, limit: int = 100):
    params: dict = {
        "select": "id,name,type,prompt,created_at",
        "user_id": f"eq.{user_id}",
        "order": "created_at.desc",
        "limit": limit,
    }
    if typ in ("hook","script","caption"):
        params["type"] = f"eq.{typ}"
    if search:
        params["name"] = f"ilike.%{search}%"
    return await _get("/rest/v1/templates", params)

async def templates_create(user_id: str, name: str, typ: str, prompt: dict):
    payload = {"user_id": user_id, "name": name, "type": typ, "prompt": prompt}
    return await _post("/rest/v1/templates", payload)

async def templates_update(id_: int, user_id: str, patch: dict):
    # Patch nur auf eigene Zeile anwenden
    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        r = await client.patch(
            f"{SUPABASE_URL}/rest/v1/templates",
            headers=_headers(),
            params={"id": f"eq.{id_}", "user_id": f"eq.{user_id}"},
            json=patch,
        )
        r.raise_for_status()
        return r.json() if r.text else None

async def templates_delete(id_: int, user_id: str):
    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        r = await client.delete(
            f"{SUPABASE_URL}/rest/v1/templates",
            headers=_headers(),
            params={"id": f"eq.{id_}", "user_id": f"eq.{user_id}"},
        )
        r.raise_for_status()
        return True
    

async def get_upcoming_slots(window_minutes: int = 30) -> list[dict]:
    """
    Liefert Planner-Slots, die in den nächsten `window_minutes` fällig sind
    und noch nicht erinnert wurden. Enthält die verknüpfte Nutzer-E-Mail.
    """
    now = datetime.now(timezone.utc)
    since = now.isoformat()
    until = (now + timedelta(minutes=window_minutes)).isoformat()

    # PostgREST-AND-Filter verwenden, um beide Zeitbedingungen zu kombinieren
    params = {
        "select": "id,user_id,platform,scheduled_at,note,reminder_sent,users_public(email)",
        "reminder_sent": "is.false",
        "and": f"(gte.scheduled_at.{since},lte.scheduled_at.{until})",
        "order": "scheduled_at.asc",
        "limit": 500,
    }
    return await _get("/rest/v1/planner_slots", params)

async def mark_reminded(ids: List[int]) -> bool:
    """Setzt reminder_sent=true für die übergebenen Slot-IDs."""
    if not ids:
        return True
    ids_str = ",".join(str(i) for i in ids)
    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        r = await client.patch(
            f"{SUPABASE_URL}/rest/v1/planner_slots",
            headers=_headers(),
            params={"id": f"in.({ids_str})"},
            json={"reminder_sent": True},
        )
        r.raise_for_status()
    return True

# --- Users Public: Read/Update ---------------------------------------------

async def get_profile(user_id: str) -> Optional[Dict[str, Any]]:
    """
    Holt das users_public-Profil zur gegebenen auth.users.id.
    """
    items = await _get("/rest/v1/users_public", {
        "user_id": f"eq.{user_id}",
        "limit": 1,
        "select": "user_id,handle,niche,target,email,brand_voice,monthly_credit_limit,onboarding_done,created_at",
    })
    return items[0] if items else None

async def update_profile(user_id: str, patch: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Optionaler Helper: Patcht das Profil des Nutzers (nur eigene Zeile).
    Praktisch für Settings/Onboarding-Endpunkte.
    """
    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        r = await client.patch(
            f"{SUPABASE_URL}/rest/v1/users_public",
            headers=_headers(),
            params={"user_id": f"eq.{user_id}", "limit": 1},
            json=patch,
        )
        r.raise_for_status()
        return r.json()[0] if r.text else None