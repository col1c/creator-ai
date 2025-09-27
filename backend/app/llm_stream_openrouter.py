# app/llm_stream_openrouter.py
from __future__ import annotations
import json
import asyncio
import httpx
from typing import AsyncGenerator, Dict, Optional

from .config import settings

# --- Minimaler Prompt-Builder (kompatibel zu deinem Setup) -------------------
def _build_messages(
    typ: str,
    topic: str,
    niche: str,
    tone: str,
    voice: Optional[dict] = None,
) -> list[dict]:
    # Brand-Voice in den Systemprompt einbetten
    bv_lines = []
    if isinstance(voice, dict):
        if voice.get("tone"):
            bv_lines.append(f"Ton: {voice.get('tone')}")
        if voice.get("forbidden"):
            bv_lines.append(f"Tabuwörter: {', '.join(voice.get('forbidden') or [])}")
        if voice.get("emojis") is not None:
            bv_lines.append(f"Emojis erlaubt: {'ja' if voice.get('emojis') else 'nein'}")
        if voice.get("cta"):
            bv_lines.append(f"CTA-Beispiele: {', '.join(voice.get('cta') or [])}")
    bv = ("\n".join(bv_lines)).strip()

    sys = (
        "Du bist eine KI für Shortform-Content (TikTok/IG/YT Shorts).\n"
        f"Zielnische: {niche}\n"
        f"{('Brand-Voice:\n' + bv) if bv else ''}\n"
        "Antwort immer kurz, präzise und in natürlichem Deutsch."
    ).strip()

    if typ == "hook":
        user = (
            f"Aufgabe: Erzeuge 10 starke Hook-Ideen (max. 9 Wörter) zum Thema „{topic}“.\n"
            "Formate mischen: Frage/Schock/Value. Nummeriert, jeweils eine Zeile. Keine Erklärungen."
        )
    elif typ == "script":
        user = (
            f"Aufgabe: 30–45s Skript für Thema „{topic}“.\n"
            "Struktur: 1) Hook 2) 3–4 konkrete Value-Punkte 3) CTA.\n"
            "2 Varianten. Kurze Sätze, aktive Verben, keine Füllwörter."
        )
    elif typ == "caption":
        user = (
            f"Aufgabe: 3 Captions zu „{topic}“.\n"
            "Längen: kurz/mittel/lang; jeweils 1 passende CTA. Emojis nur wenn sinnvoll."
        )
    else:  # hashtags
        user = (
            f"Aufgabe: Hashtags zu „{topic}“.\n"
            "12–18 Stück: ~70% Nische, ~30% breit. Keine verbotenen Begriffe der Plattformen."
        )

    return [
        {"role": "system", "content": sys},
        {"role": "user", "content": user},
    ]

# --- Streaming-Client --------------------------------------------------------
async def stream_openrouter(
    typ: str,
    topic: str,
    niche: str,
    tone: str,
    voice: Optional[dict] = None,
    temperature: float = 0.7,
    max_tokens: int = 700,
) -> AsyncGenerator[str, None]:
    """
    Liefert inkrementell Tokens/Textstücke (bereits zusammengesetzt aus deltas).
    Nutzt OpenRouter (OpenAI-kompatibles Chat Completions-API) mit stream=true.
    """
    if not settings.OPENROUTER_API_KEY:
        raise RuntimeError("OPENROUTER_API_KEY not configured")

    headers = {
        "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
    }
    if settings.OPENROUTER_SITE_URL:
        headers["HTTP-Referer"] = settings.OPENROUTER_SITE_URL
        headers["X-Title"] = settings.OPENROUTER_APP_TITLE or "Creator AI"

    body: Dict = {
        "model": settings.OPENROUTER_MODEL or "x-ai/grok-4-fast:free",
        "stream": True,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "messages": _build_messages(typ, topic, niche, tone, voice),
    }

    url = "https://openrouter.ai/api/v1/chat/completions"

    async with httpx.AsyncClient(timeout=None) as client:
        async with client.stream("POST", url, headers=headers, json=body) as resp:
            resp.raise_for_status()
            async for raw_line in resp.aiter_lines():
                if not raw_line:
                    continue
                # SSE-Format: "data: {...}"
                if raw_line.startswith("data:"):
                    data = raw_line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        obj = json.loads(data)
                        choice = (obj.get("choices") or [{}])[0]
                        delta = (choice.get("delta") or {})
                        token = delta.get("content")
                        if token:
                            yield token
                    except Exception:
                        # ignore malformed lines silently
                        continue
                await asyncio.sleep(0)
