# app/cache.py
import hashlib, json
from typing import Any, Dict

CANON_KEYS = ("topic","niche","tone","voice","hashtags_base","forbidden","cta","emojis")

def _clean(v):
    if isinstance(v, str): return v.strip()
    if isinstance(v, list): return [_clean(x) for x in v if x is not None]
    if isinstance(v, dict): return {k:_clean(v[k]) for k in sorted(v) if v[k] is not None}
    return v

def normalize_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    # nur relevante Felder, rest ignorieren
    norm: Dict[str, Any] = {}
    for k in CANON_KEYS:
        if k in payload and payload[k] is not None:
            norm[k] = _clean(payload[k])
    # falls frontend andere Namen nutzt, hier mappen:
    # z.B. payload.get("brand_voice") -> "voice"
    if "brand_voice" in payload and "voice" not in norm:
        norm["voice"] = _clean(payload["brand_voice"])
    return norm

def make_cache_key(user_id: str, typ: str, payload: Dict[str, Any]) -> str:
    norm = normalize_payload(payload)
    blob = f"{user_id}|{typ}|{json.dumps(norm, sort_keys=True, separators=(',',':'))}"
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()
