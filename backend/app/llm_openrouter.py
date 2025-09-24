import json, re
import httpx
from typing import Any, Dict, List
from .config import settings

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

def _headers() -> Dict[str, str]:
    h = {
        "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
    }
    # Attribution (optional aber empfohlen)
    if settings.OPENROUTER_SITE_URL:
        h["HTTP-Referer"] = settings.OPENROUTER_SITE_URL
    if settings.OPENROUTER_APP_TITLE:
        h["X-Title"] = settings.OPENROUTER_APP_TITLE
    return h

def _as_schema():
    # Striktes JSON-Objekt mit "variants": string[]
    return {
        "type": "json_schema",
        "json_schema": {
            "name": "variants_schema",
            "schema": {
                "type": "object",
                "properties": {
                    "variants": {
                        "type": "array",
                        "items": {"type": "string"},
                        "minItems": 1,
                        "maxItems": 20
                    }
                },
                "required": ["variants"],
                "additionalProperties": False
            },
            "strict": True
        }
    }

def _system_json_prompt():
    return (
        "You are a concise shortform content writer.\n"
        "Always reply ONLY with strict JSON that matches this schema: "
        '{"variants": ["string", "..."]}. No markdown, no code fences, no explanations.'
    )

def _user_prompt(kind: str, topic: str, niche: str, tone: str, voice: dict | None) -> str:
    v = voice or {}
    emojis = v.get("emojis", True)
    forbidden = ", ".join(v.get("forbidden", []) or [])
    ctas = v.get("cta", [])
    hashtags_base = v.get("hashtags_base", [])

    base = [
        f"TYPE: {kind}",
        f"TOPIC: {topic}",
        f"NICHE: {niche}",
        f"TONE: {tone}",
        f"EMOJIS_ALLOWED: {bool(emojis)}",
        f"FORBIDDEN_WORDS: [{forbidden}]",
    ]
    if ctas:
        base.append("CTAS: " + " | ".join(ctas))
    if hashtags_base:
        base.append("BASE_HASHTAGS: " + " ".join(hashtags_base))

    # Vorgaben pro Typ
    if kind == "hook":
        base += [
            "OUTPUT: 10 hooks, max 9 words each, punchy.",
            "NO explanations."
        ]
    elif kind == "script":
        base += [
            "OUTPUT: 2 scripts (30-45s) with structure: Hook -> 3 Value points -> CTA.",
            "Use simple sentences, active voice."
        ]
    elif kind == "caption":
        base += [
            "OUTPUT: 3 captions: short (~15 words), medium (~35 words), long (~60-80 words).",
            "Add exactly 1 CTA line to the long variant if CTAs are given."
        ]
    elif kind == "hashtags":
        base += [
            "OUTPUT: 12-16 hashtags. Start with BASE_HASHTAGS if provided, then niche-specific, then 2-3 broad.",
            "No duplicates."
        ]

    # Verbote
    if forbidden:
        base.append("Mask or avoid any FORBIDDEN_WORDS.")

    return "\n".join(base)

def _parse_variants(content: str) -> List[str]:
    # JSON direkt
    try:
        obj = json.loads(content)
        if isinstance(obj, dict) and "variants" in obj and isinstance(obj["variants"], list):
            return [str(x) for x in obj["variants"]]
    except Exception:
        pass
    # Notfall: aus Text varianten extrahieren (--- Trennzeichen oder Zeilen)
    parts = re.split(r"\n-{3,}\n", content.strip())
    if len(parts) > 1:
        return [p.strip() for p in parts if p.strip()]
    # Letzter Fallback: Zeilen
    lines = [l.strip(" -•\t") for l in content.splitlines() if l.strip()]
    return lines[:10] if lines else []

def call_openrouter(kind: str, topic: str, niche: str, tone: str, voice: dict | None) -> List[str]:
    if not settings.OPENROUTER_API_KEY:
        raise RuntimeError("OPENROUTER_API_KEY not set")

    messages = [
        {"role": "system", "content": _system_json_prompt()},
        {"role": "user", "content": _user_prompt(kind, topic, niche, tone, voice)},
    ]

    payload: Dict[str, Any] = {
        "model": settings.OPENROUTER_MODEL,
        "messages": messages,
        "temperature": 0.7 if kind in ("hook","caption") else 0.4,
        "max_tokens": 1200,
        "seed": 7,
    }

    # JSON Mode / Structured Outputs
    if settings.LLM_JSON_MODE.lower() == "on":
        # Priorität: json_schema (strikter) – fallback handled by server
        payload["response_format"] = _as_schema()

    # Reasoning schalten (aus, wenn du nur Speed willst)
    if settings.LLM_REASONING.lower() == "on":
        payload["reasoning"] = {
            "enabled": True,
            "effort": "medium",
            "exclude": True  # reasoning nicht im finalen Text anzeigen
        }

    with httpx.Client(timeout=60.0) as c:
        r = c.post(OPENROUTER_URL, headers=_headers(), json=payload)
        # 429/403 → Caller soll fallbacken
        if r.status_code in (429, 403, 402):
            raise RuntimeError(f"OpenRouter limit/forbidden: {r.status_code} {r.text[:200]}")
        r.raise_for_status()
        data = r.json()

    content = data["choices"][0]["message"]["content"]
    return _parse_variants(content)
