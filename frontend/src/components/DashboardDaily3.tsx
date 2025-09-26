import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

/** API-Basis (für /api/v1/usage Logging) */
const RAW_API_BASE = import.meta.env.VITE_API_BASE as string;
const API_BASE = (RAW_API_BASE || "").replace(/\/+$/, "");
const api = (path: string) => `${API_BASE}${path}`;

type Platform = "tiktok" | "instagram" | "youtube" | "shorts" | "reels" | "other";
const PLATFORMS: { value: Platform; label: string }[] = [
  { value: "tiktok", label: "TikTok" },
  { value: "instagram", label: "Instagram" },
  { value: "youtube", label: "YouTube" },
  { value: "shorts", label: "YouTube Shorts" },
  { value: "reels", label: "Instagram Reels" },
  { value: "other", label: "Andere" },
];

type Idea = { text: string };

function sample<T>(arr: T[]) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Lokale Generator-Heuristik (keine LLM-Kosten) */
function generateIdeas(brand: string, tone: string, niche: string): Idea[] {
  const tones = tone ? [tone] : ["frech", "knapp", "motivational", "praxisnah"];
  const actions = [
    "3 Fehler, die {niche}-Anfänger machen (und wie {brand} sie vermeidet)",
    "So erreichst du {niche}-Growth in 7 Tagen – ohne Bullshit",
    "Hook-Formel: „{benefit} in {time} – selbst wenn {pain}“",
    "Fallstudie: {brand} skaliert {niche} Content → von 0 auf 10K Views/Tag",
    "Script-Skelett: Hook → Pain → Mini-Tutorial → CTA ({brand} Flavor)",
    "Checkliste: {niche}-Post in 5 Minuten (Template von {brand})",
  ];
  const benefits = ["mehr Reichweite", "tägliche Leads", "höhere Watchtime", "sichere Conversions"];
  const pains = ["du wenig Zeit hast", "du keine Ideen hast", "du Kamera-Scheu hast", "der Algorithmus zickt"];
  const times = ["7 Tagen", "48 Stunden", "14 Tagen", "1 Woche"];

  const fill = (tmpl: string) =>
    tmpl
      .replace(/\{brand\}/g, brand || "deine Brand")
      .replace(/\{niche\}/g, niche || "Content")
      .replace(/\{benefit\}/g, sample(benefits))
      .replace(/\{pain\}/g, sample(pains))
      .replace(/\{time\}/g, sample(times));

  const out: Idea[] = [];
  for (let i = 0; i < 3; i++) {
    out.push({ text: `[${sample(tones)}] ${fill(sample(actions))}` });
  }
  return out;
}

export default function DashboardDaily3() {
  const [uid, setUid] = useState<string | null>(null);

  // Inputs
  const [brand, setBrand] = useState("");
  const [tone, setTone] = useState("");
  const [niche, setNiche] = useState("");

  // Ideen
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(false);

  // Planner-Quick-Add UI State (pro Karte)
  const [schedule, setSchedule] = useState<Record<number, string>>({});
  const [platformSel, setPlatformSel] = useState<Record<number, Platform>>({});

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const user = data.user;
      setUid(user?.id ?? null);

      // evtl. vorhandene Profile-Defaults hier laden (wenn du willst)
    })();
  }, []);

  const regen = () => {
    setIdeas(generateIdeas(brand.trim(), tone.trim(), niche.trim()));
  };

  useEffect(() => {
    // erste Ladung
    regen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logEvent = async (event: string, meta: any = {}) => {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      await fetch(api("/api/v1/usage"), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ event, meta }),
      });
    } catch {}
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      await logEvent("daily3_copy", {});
      alert("Kopiert.");
    } catch {
      alert("Konnte nicht kopieren.");
    }
  };

  const save = async (idea: Idea) => {
    if (!uid) return alert("Bitte einloggen.");
    try {
      const { error } = await supabase.from("daily_ideas").insert({
        user_id: uid,
        idea: idea.text,
        meta: { brand, tone, niche, source: "daily3" },
      });
      if (error) throw error;
      await logEvent("daily3_save", {});
      alert("Gespeichert.");
    } catch (e: any) {
      alert(e?.message || "Konnte nicht speichern.");
    }
  };

  const quickAddToPlanner = async (idx: number, idea: Idea) => {
    if (!uid) return alert("Bitte einloggen.");
    const dtLocal = schedule[idx];
    const platform = platformSel[idx] || "tiktok";
    if (!dtLocal) return alert("Bitte Datum/Zeit wählen.");

    try {
      const iso = new Date(dtLocal).toISOString(); // UTC
      const { error } = await supabase.from("planner_slots").insert({
        user_id: uid,
        platform,
        scheduled_at: iso,
        note: idea.text.slice(0, 240),
      });
      if (error) throw error;
      await logEvent("daily3_plan", { platform });
      alert("Zum Planner hinzugefügt.");
    } catch (e: any) {
      alert(e?.message || "Konnte nicht planen.");
    }
  };

  const defaults = useMemo(() => {
    const n = new Date();
    const pad = (x: number) => String(x).padStart(2, "0");
    // Jetzt + 2h als Default (lokal)
    n.setHours(n.getHours() + 2);
    const local = `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}T${pad(n.getHours())}:${pad(n.getMinutes())}`;
    return local;
  }, []);

  return (
    <div className="max-w-4xl mx-auto p-4">
      <h1 className="text-xl font-semibold mb-3">Dashboard – Daily 3</h1>

      {/* Controls */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
        <div>
          <label className="block text-xs uppercase mb-1">Brand</label>
          <input
            className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-neutral-700"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            placeholder="z. B. CreatorAI"
          />
        </div>
        <div>
          <label className="block text-xs uppercase mb-1">Tone/Voice</label>
          <input
            className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-neutral-700"
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            placeholder="z. B. frech, praxisnah"
          />
        </div>
        <div>
          <label className="block text-xs uppercase mb-1">Niche/Topic</label>
          <input
            className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-neutral-700"
            value={niche}
            onChange={(e) => setNiche(e.target.value)}
            placeholder="z. B. Kurzvideo-Growth"
          />
        </div>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => { setLoading(true); regen(); setLoading(false); }}
          className="px-3 py-2 rounded-xl border"
        >
          Regenerieren
        </button>
      </div>

      {/* Ideas */}
      <div className="grid grid-cols-1 gap-3">
        {ideas.map((idea, idx) => (
          <div key={idx} className="rounded-2xl border p-3 bg-white dark:bg-neutral-800">
            <div className="text-sm whitespace-pre-wrap">{idea.text}</div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button onClick={() => copy(idea.text)} className="px-3 py-2 rounded-xl border">Copy</button>
              <button onClick={() => save(idea)} className="px-3 py-2 rounded-xl border">Save</button>

              {/* Quick Add */}
              <select
                className="px-3 py-2 rounded-lg border bg-white dark:bg-neutral-700"
                value={platformSel[idx] || "tiktok"}
                onChange={(e) => setPlatformSel((s) => ({ ...s, [idx]: e.target.value as Platform }))}
              >
                {PLATFORMS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
              <input
                type="datetime-local"
                className="px-3 py-2 rounded-lg border bg-white dark:bg-neutral-700"
                value={schedule[idx] ?? defaults}
                onChange={(e) => setSchedule((s) => ({ ...s, [idx]: e.target.value }))}
              />
              <button onClick={() => quickAddToPlanner(idx, idea)} className="px-3 py-2 rounded-xl border">
                Planner-Quick-Add
              </button>
            </div>
          </div>
        ))}
      </div>

      {loading && (
        <div className="p-3 rounded-xl border text-sm opacity-70 mt-3">
          Generiere…
        </div>
      )}
    </div>
  );
}
