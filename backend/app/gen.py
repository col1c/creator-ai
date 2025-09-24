from datetime import datetime
from random import choice, sample

def gen_hooks(topic: str, niche: str, tone: str) -> list[str]:
    patterns = [
        "Der größte Fehler bei {topic} (den 90% machen)",
        "3 Fakten zu {topic}, die dich überraschen werden",
        "Warum {topic} in {niche} 2025 alles verändert",
        "Niemand sagt dir das über {topic}…",
        "{topic} in 30 Sekunden: Das musst du wissen",
        "Die 5-Sekunden-Regel für {topic}",
        "Wenn ich heute bei {topic} neu starten würde…",
        "So machst du {topic} 10× schneller",
        "Stop doing this: {topic} in {niche}",
        "Bevor du mit {topic} anfängst, sieh das"
    ]
    base = [p.format(topic=topic, niche=niche) for p in patterns]
    # Ton leicht variieren
    if "locker" in tone.lower():
        base = [b.replace("…", " 😮").replace("!", "") for b in base]
    return base[:10]

def gen_script(topic: str, niche: str, tone: str, seconds: int = 35) -> list[str]:
    hook = choice(gen_hooks(topic, niche, tone))
    values = sample([
        f"Schneller Einstieg: fokussiere 1 Ziel rund um {topic}",
        f"Vermeide Streuverlust: 1 Format, 1 Kernbotschaft",
        f"Baue Proof: mini-Case in {niche} zeigen",
        f"Nutze 3-Teil-Struktur: Hook → Value → CTA",
        f"Tracke Resultate wöchentlich, nicht täglich",
        f"Wiederhole, was funktioniert (80/20-Prinzip)"
    ], 3)
    cta = choice([
        "Speichere das & probier’s heute aus.",
        "Frag unten nach einer Vorlage.",
        "Follow für mehr 30-Sek.-Taktiken."
    ])
    base = f"""HOOK: {hook}
VALUE 1: {values[0]}
VALUE 2: {values[1]}
VALUE 3: {values[2]}
CTA: {cta}"""
    alt = f"""HOOK: {choice(gen_hooks(topic, niche, tone))}
SCHRITT 1: Problem in {niche} kurz zeigen
SCHRITT 2: Lösung mit {topic} in 2 Punkten
SCHRITT 3: Ergebnis/Proof andeuten
CTA: {cta}"""
    return [base, alt]

def gen_caption(topic: str, niche: str, tone: str) -> list[str]:
    short = f"{topic} in {niche}: 3 Dinge, die sofort wirken. 🚀 #{niche}"
    mid = f"{topic} schnell erklärt: Fokus, Konsistenz, Messbarkeit. Wenn du das beherrschst, wächst du — ohne Ausreden."
    long = (f"Heute geht’s um {topic} für {niche}. "
            "Starte klein, bleib konsistent, verbessere jede Woche eine Sache. "
            "Frag in den Kommentaren nach einer passenden Vorlage.")
    return [short, mid, long]

def gen_hashtags(topic: str, niche: str) -> list[str]:
    base = [
        f"#{niche}", f"#{topic.replace(' ', '')}", "#learn", "#growth",
        "#creator", "#tips", "#howto", "#shorts", "#tiktok", "#reels",
        "#content", "#viral", "#strategy", "#daily", "#consistency"
    ]
    # Ein wenig mischen und 12–16 zurückgeben
    return sample(base, k=min(len(base), 14))

def generate(kind: str, topic: str, niche: str, tone: str):
    now = datetime.utcnow().isoformat()
    if kind == "hook":
        data = gen_hooks(topic, niche, tone)
    elif kind == "script":
        data = gen_script(topic, niche, tone)
    elif kind == "caption":
        data = gen_caption(topic, niche, tone)
    elif kind == "hashtags":
        data = gen_hashtags(topic, niche)
    else:
        raise ValueError("Unsupported type")
    return {"generated_at": now, "type": kind, "variants": data}
