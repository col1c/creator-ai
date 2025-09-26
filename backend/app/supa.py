# app/supa.py
# Zweck: Supabase REST Helpers (mix aus sync/async für Rückwärtskompatibilität mit main.py)

from __future__ import annotations
import os
import httpx
from typing import Any, Dict, Optional, List, Tuple
from datetime import datetime, timezone, timedelta

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SERVICE_ROLE = os.environ["SUPABASE_SERVICE_ROLE"]

DEFAULT_TIMEOUT = httpx.Timeout(15.0, read=15.0, write=15.0, connect=10.0)


# ---------------------------------------------------------------------------
# Gemeinsame Header
# ---------------------------------------------------------------------------
def _headers() -> Dict[str, str]:
    return {
        "apikey": SERVICE_ROLE,
        "Authorization": f"Bearer {SERVICE_ROLE}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


# ---------------------------------------------------------------------------
# Async HTTP helpers (für async-APIs)
# ---------------------------------------------------------------------------
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


# ---------------------------------------------------------------------------
# Sync HTTP helpers (für Funktionen, die in main.py ohne await genutzt werden)
# ---------------------------------------------------------------------------
def _get_sync(path: str, params: Optional[Dict[str, Any]] = None, extra_headers: Optional[Dict[str, str]] = None) -> Tuple[Any, httpx.Response]:
    hdrs = _headers()
    if extra_headers:
        hdrs.update(extra_headers)
    with httpx.Client(timeout=DEFAULT_TIMEOUT) as client:
        r = client.get(f"{SUPABASE_URL}{path}", headers=hdrs, params=params)
        r.raise_for_status()
        try:
            data = r.json()
        except Exception:
            data = None
        return data, r

def _post_sync(path: str, json: Dict[str, Any], extra_headers: Optional[Dict[str, str]] = None) -> Any:
    hdrs = _headers()
    if extra_headers:
        hdrs.update(extra_headers)
    with httpx.Client(timeout=DEFAULT_TIMEOUT) as client:
        r = client.post(f"{SUPABASE_URL}{path}", headers=hdrs, json=json)
        r.raise_for_status()
        return r.json() if r.text else None

def _patch_sync(path: str, params: Dict[str, Any], json: Dict[str, Any]) -> Any:
    with httpx.Client(timeout=DEFAULT_TIMEOUT) as client:
        r = client.patch(f"{SUPABASE_URL}{path}", headers=_headers(), params=params, json=json)
        r.raise_for_status()
        return r.json() if r.text else None

def _delete_sync(path: str, params: Dict[str, Any]) -> Any:
    with httpx.Client(timeout=DEFAULT_TIMEOUT) as client:
        r = client.delete(f"{SUPABASE_URL}{path}", headers=_headers(), params=params)
        r.raise_for_status()
        return True


# ---------------------------------------------------------------------------
# Auth / User
# Hybrid-Ansatz: sofort nutzbar (sync) + await-bar (für async-Stellen)
# ---------------------------------------------------------------------------
class _UserResult(dict):
    """Dict, das auch await-bar ist (await gibt sich selbst zurück)."""
    def __await__(self):
        async def _coro():
            return self
        return _coro().__await__()

def get_user_from_token(access_token: str) -> _UserResult:
    """
    Wird in main.py teils sync, teils mit await genutzt.
    Hier: synchroner HTTP-Call; Rückgabe ist dict-ähnlich und await-bar.
    """
    headers = {
        "apikey": SERVICE_ROLE,
        "Authorization": f"Bearer {access_token}",
    }
    with httpx.Client(timeout=DEFAULT_TIMEOUT) as client:
        r = client.get(f"{SUPABASE_URL}/auth/v1/user", headers=headers)
        r.raise_for_status()
        data = r.json()
        return _UserResult(data)


# ---------------------------------------------------------------------------
# Usage-Log
# ---------------------------------------------------------------------------
async def log_usage(user_id: str, event: str, meta: Optional[Dict[str, Any]] = None) -> bool:
    try:
        await _post("/rest/v1/usage_log", {"user_id": user_id, "event": event, "meta": meta or {}})
    except Exception:
        return False
    return True


# ---------------------------------------------------------------------------
# Prompt-Cache (async, wird im Generate-Endpoint awaited)
# ---------------------------------------------------------------------------
async def cache_get_by_key(cache_key: str, user_id: str) -> Optional[Dict[str, Any]]:
    items = await _get("/rest/v1/prompt_cache", {
        "cache_key": f"eq.{cache_key}",
        "user_id": f"eq.{user_id}",
        "limit": 1,
    })
    return items[0] if items else None

async def cache_insert(entry: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    return await _post("/rest/v1/prompt_cache", entry)


# ---------------------------------------------------------------------------
# Users Public (sync read/update; async upsert optional)
# ---------------------------------------------------------------------------
def get_profile(user_id: str) -> Optional[Dict[str, Any]]:
    items, _ = _get_sync(
        "/rest/v1/users_public",
        {
            "user_id": f"eq.{user_id}",
            "limit": 1,
            "select": "user_id,handle,niche,target,email,brand_voice,monthly_credit_limit,onboarding_done,created_at",
        },
    )
    return items[0] if items else None

def get_profile_full(user_id: str) -> Optional[Dict[str, Any]]:
    """
    Für Brand-Voice im Generate-Endpoint. Aktuell identisch zu get_profile,
    aber als eigener Helper, falls du später weitere Relationen mitselektierst.
    """
    items, _ = _get_sync(
        "/rest/v1/users_public",
        {
            "user_id": f"eq.{user_id}",
            "limit": 1,
            "select": "user_id,handle,niche,target,email,brand_voice,monthly_credit_limit,onboarding_done,created_at",
        },
    )
    return items[0] if items else None

async def upsert_users_public(row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    return await _post("/rest/v1/users_public", row)

def update_profile(user_id: str, patch: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    data = _patch_sync(
        "/rest/v1/users_public",
        params={"user_id": f"eq.{user_id}", "limit": 1},
        json=patch,
    )
    if isinstance(data, list) and data:
        return data[0]
    return data


# ---------------------------------------------------------------------------
# Credits / Stats (sync, weil in main.py ohne await benutzt)
# ---------------------------------------------------------------------------
def month_start_utc(dt: Optional[datetime] = None) -> str:
    dt = dt or datetime.now(timezone.utc)
    start = datetime(dt.year, dt.month, 1, 0, 0, 0, tzinfo=timezone.utc)
    return start.isoformat()

def count_generates_this_month(user_id: str) -> int:
    """
    Zählt rows in generations ab Monatsanfang (nutzt Content-Range via count=exact).
    Holt nur Range 0-0, der Total-Wert steht im Header.
    """
    start = month_start_utc()
    params = {
        "select": "id",
        "user_id": f"eq.{user_id}",
        "created_at": f"gte.{start}",
    }
    data, resp = _get_sync(
        "/rest/v1/generations",
        params=params,
        extra_headers={"Prefer": "count=exact"},
    )
    # Content-Range: "0-0/123"
    total = 0
    cr = resp.headers.get("Content-Range") or resp.headers.get("content-range")
    if cr and "/" in cr:
        try:
            total = int(cr.split("/")[-1])
        except Exception:
            total = 0
    else:
        # Fallback (nicht ideal, aber besser als 0)
        total = len(data or [])
    return total


# ---------------------------------------------------------------------------
# Generations (optional convenience)
# ---------------------------------------------------------------------------
async def insert_generation(row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    return await _post("/rest/v1/generations", row)


# ---------------------------------------------------------------------------
# Templates CRUD (async)
# ---------------------------------------------------------------------------
async def templates_list(user_id: str, search: str | None = None, typ: str | None = None, limit: int = 100):
    params: dict = {
        "select": "id,name,type,prompt,created_at",
        "user_id": f"eq.{user_id}",
        "order": "created_at.desc",
        "limit": limit,
    }
    if typ in ("hook", "script", "caption"):
        params["type"] = f"eq.{typ}"
    if search:
        params["name"] = f"ilike.%{search}%"
    return await _get("/rest/v1/templates", params)

async def templates_create(user_id: str, name: str, typ: str, prompt: dict):
    payload = {"user_id": user_id, "name": name, "type": typ, "prompt": prompt}
    return await _post("/rest/v1/templates", payload)

async def templates_update(id_: int, user_id: str, patch: dict):
    with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        r = await client.patch(
            f"{SUPABASE_URL}/rest/v1/templates",
            headers=_headers(),
            params={"id": f"eq.{id_}", "user_id": f"eq.{user_id}"},
            json=patch,
        )
        r.raise_for_status()
        return r.json() if r.text else None

async def templates_delete(id_: int, user_id: str):
    with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        r = await client.delete(
            f"{SUPABASE_URL}/rest/v1/templates",
            headers=_headers(),
            params={"id": f"eq.{id_}", "user_id": f"eq.{user_id}"},
        )
        r.raise_for_status()
        return True


# ---------------------------------------------------------------------------
# Planner Helpers (sync) – für /api/v1/planner/remind in main.py
# ---------------------------------------------------------------------------
def get_upcoming_slots(*, hours_ahead: Optional[int] = None, window_minutes: Optional[int] = None) -> List[Dict[str, Any]]:
    """
    Liefert Slots im kommenden Zeitfenster, die noch nicht erinnert wurden.
    Main ruft mit hours_ahead=26 auf. Join auf users_public(email).
    """
    if hours_ahead is None and window_minutes is None:
        hours_ahead = 24
    if window_minutes is None:
        window_minutes = int(hours_ahead * 60)

    now = datetime.now(timezone.utc)
    since = now.isoformat()
    until = (now + timedelta(minutes=window_minutes)).isoformat()

    params = {
        "select": "id,user_id,platform,scheduled_at,note,reminder_sent,users_public(email)",
        "reminder_sent": "is.false",
        "and": f"(gte.scheduled_at.{since},lte.scheduled_at.{until})",
        "order": "scheduled_at.asc",
        "limit": 500,
    }
    data, _ = _get_sync("/rest/v1/planner_slots", params=params)
    return data or []

def mark_reminded(ids: int | List[int]) -> bool:
    """
    Setzt reminder_sent=true.
    Akzeptiert einzelne ID oder Liste von IDs.
    """
    if isinstance(ids, int):
        ids = [ids]
    if not ids:
        return True
    ids_str = ",".join(str(i) for i in ids)
    _patch_sync(
        "/rest/v1/planner_slots",
        params={"id": f"in.({ids_str})"},
        json={"reminder_sent": True},
    )
    return True
