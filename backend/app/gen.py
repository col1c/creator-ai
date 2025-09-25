from datetime import datetime
from random import choice, sample
import re

def _norm_voice(voice: dict | None) -> dict:
    v = voice or {}
    return {
        "tone": v.get("tone", "locker"),
        "emojis": bool(v.get("emojis", True)),
        "cta": v.get("cta", ["Folge für mehr.", "Speichere & probier’s heute aus.", "Frag in den Kommentaren."]),
        "forbidden": [w.strip().lower() for w in v.get("forbidden", []) if isinstance(w, str)],
        "hashtags_base": [h.strip() for h in v.get("hashtags_base", []) if isinstance(h, str) and h.strip()],
    }

def _strip_forbidden(txt: str, forbidden: list[str]) -> str:
    if not forbidden: return txt
    out = txt
    for w in forbidden:
        out = re.sub(rf"\b{re.escape(w)}\b", "▮▮", out, flags=re.IGNORECASE)
    return out

def _maybe_drop_emojis(txts: list[str], allow: bool) -> list[str]:
    if allow: return txts
    return [re.sub(r"[^\w\s\-.,!?:;#€/€%]", "", t) for t in txts]

def _append_cta(txt: str, ctas: list[str]) -> str:
    cta = choice(ctas) if ctas else ""
    if not cta: return txt
    return f"{txt}\nCTA: {cta}"

def _words(text: str) -> list[str]:
    # trennt auf Leerzeichen, entfernt doppelte, säubert Satzzeichen am Ende
    t = re.sub(r"[.!?️]+$", "", text.strip())
    return [w for w in re.split(r"\s+", t) if w]

def _tighten_to_range(s: str, lo=7, hi=9) -> str:
    ws = _words(s)
    if len(ws) < lo:
        return " ".join(ws)  # kürzer lassen, falls zu kurz
    if len(ws) > hi:
        ws = ws[:hi]
    return " ".join(ws)

def gen_hooks(topic: str, niche: str, tone: str, voice: dict | None) -> list[str]:
    v = _norm_voice(voice)
    patterns = [
        "Der größte Fehler bei {topic}",
        "3 schnelle Schritte für {topic}",
        "{topic} in {niche}: so klappt’s",
        "Warum {topic} heute Pflicht ist",
        "Niemand sagt dir das über {topic}",
        "{topic} ohne teure Tools",
        "{topic}: die 80/20-Abkürzung",
        "So startest du {topic} richtig",
        "Stop wasting Zeit: {topic}",
        "Bevor du {topic} beginnst, lies das"
    ]
    base = [p.format(topic=topic, niche=niche) for p in patterns]
    if "locker" in (v["tone"] or tone).lower():
        base = [b.replace("Niemand sagt dir das über", "Das sagt dir keiner über") for b in base]

    # 7–9 Wörter, Emojis ggf. entfernen, verbotene Wörter maskieren
    outs = []
    seen = set()
    for b in base:
        h = _tighten_to_range(b, 7, 9)
        h = _strip_forbidden(h, v["forbidden"])
        if not v["emojis"]:
            h = re.sub(r"[^\w\s\-.,?€%]", "", h)
        if h.lower() not in seen:
            seen.add(h.lower())
            outs.append(h)
    return outs[:10]


def gen_script(topic: str, niche: str, tone: str, voice: dict | None, seconds: int = 35) -> list[str]:
    v = _norm_voice(voice)
    hook = choice(gen_hooks(topic, niche, tone, voice))
    values = sample([
        f"Schneller Einstieg: fokussiere 1 Ziel rund um {topic}",
        f"Vermeide Streuverlust: 1 Format, 1 Kernbotschaft",
        f"Mini-Proof in {niche} zeigen (Vorher/Nachher kurz)",
        f"Struktur: Hook → Value → CTA, bleib in {seconds}s",
        f"Tracke wöchentlich, nicht täglich (Trend sehen)",
        f"Wiederhole, was funktioniert (80/20-Prinzip)"
    ], 3)
    cta_block = choice(v["cta"])
    base = f"""HOOK: {hook}
VALUE 1: {values[0]}
VALUE 2: {values[1]}
VALUE 3: {values[2]}
CTA: {cta_block}"""
    alt = f"""HOOK: {choice(gen_hooks(topic, niche, tone, voice))}
SCHRITT 1: Problem in {niche} kurz zeigen
SCHRITT 2: Lösung mit {topic} in 2 Punkten
SCHRITT 3: Ergebnis/Proof andeuten
CTA: {cta_block}"""
    outs = [base, alt]
    outs = [_strip_forbidden(o, v["forbidden"]) for o in outs]
    outs = _maybe_drop_emojis(outs, v["emojis"])
    return outs

def gen_caption(topic: str, niche: str, tone: str, voice: dict | None) -> list[str]:
    v = _norm_voice(voice)
    short = f"{topic} in {niche}: 3 Dinge, die sofort wirken. 🚀 #{niche}"
    mid = f"{topic} schnell erklärt: Fokus, Konsistenz, Messbarkeit. Wenn du das beherrschst, wächst du — ohne Ausreden."
    long = (f"Heute geht’s um {topic} für {niche}. "
            "Starte klein, bleib konsistent, verbessere jede Woche eine Sache. "
            "Frag in den Kommentaren nach einer passenden Vorlage.")
    outs = [short, mid, _append_cta(long, v["cta"])]
    outs = [_strip_forbidden(o, v["forbidden"]) for o in outs]
    outs = _maybe_drop_emojis(outs, v["emojis"])
    return outs

def gen_hashtags(topic: str, niche: str, voice: dict | None) -> list[str]:
    v = _norm_voice(voice)
    base = list(dict.fromkeys(  # dedupe, preserve order
        v["hashtags_base"] + [
            f"#{niche}", f"#{topic.replace(' ', '')}", "#learn", "#growth",
            "#creator", "#tips", "#howto", "#shorts", "#tiktok", "#reels",
            "#content", "#viral", "#strategy", "#daily", "#consistency"
        ]
    ))
    return base[:14]

def generate(kind: str, topic: str, niche: str, tone: str, voice: dict | None = None):
    now = datetime.utcnow().isoformat()
    if kind == "hook":
        data = gen_hooks(topic, niche, tone, voice)
    elif kind == "script":
        data = gen_script(topic, niche, tone, voice)
    elif kind == "caption":
        data = gen_caption(topic, niche, tone, voice)
    elif kind == "hashtags":
        data = gen_hashtags(topic, niche, voice)
    else:
        raise ValueError("Unsupported type")
    return {"generated_at": now, "type": kind, "variants": data}
