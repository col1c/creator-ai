import { useEffect, useMemo, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE as string;

type GenType = "hook" | "script" | "caption" | "hashtags";

export default function App() {
  const [type, setType] = useState<GenType>("hook");
  const [topic, setTopic] = useState("Muskelaufbau");
  const [niche, setNiche] = useState("fitness");
  const [tone, setTone] = useState("locker");
  const [loading, setLoading] = useState(false);
  const [variants, setVariants] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [warm, setWarm] = useState(false);

  // Backend warm pingen (Render kaltstart)
  useEffect(() => {
    const warmup = async () => {
      try {
        await fetch(`${API_BASE}/health`, { cache: "no-store" });
        setWarm(true);
      } catch {
        setWarm(false);
      }
    };
    warmup();
  }, []);

  const canGenerate = useMemo(
    () => topic.trim().length > 1 && niche.trim().length > 0 && tone.trim().length > 0,
    [topic, niche, tone]
  );

  const generate = async () => {
    if (!canGenerate) return;
    setLoading(true);
    setError(null);
    setVariants([]);
    try {
      const res = await fetch(`${API_BASE}/api/v1/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, topic, niche, tone }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const outs: string[] = data?.variants ?? [];
      setVariants(outs);
    } catch (e: any) {
      setError(e?.message || "Fehler bei der Generierung");
    } finally {
      setLoading(false);
    }
  };

  const copy = async (txt: string) => {
    try {
      await navigator.clipboard.writeText(txt);
      alert("Kopiert ✅");
    } catch {
      alert("Kopieren fehlgeschlagen");
    }
  };

  const Tab = ({ k, label }: { k: GenType; label: string }) => (
    <button
      onClick={() => setType(k)}
      className={
        "px-3 py-2 rounded-lg text-sm border " +
        (type === k ? "bg-black text-white dark:bg-white dark:text-black" : "bg-transparent")
      }
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100">
      <header className="max-w-4xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold">Creator AI – Shortform Generator</h1>
        <p className="text-sm opacity-70">
          {warm ? "Backend bereit ✅" : "Backend wecken… (Render Kaltstart)"} • API: {API_BASE}
        </p>
      </header>

      <main className="max-w-4xl mx-auto px-4 pb-24">
        {/* Tabs */}
        <div className="flex gap-2 mb-4">
          <Tab k="hook" label="Hooks" />
          <Tab k="script" label="Skripte" />
          <Tab k="caption" label="Captions" />
          <Tab k="hashtags" label="Hashtags" />
        </div>

        {/* Form */}
        <div className="grid md:grid-cols-3 gap-3 mb-4">
          <div className="col-span-1 md:col-span-1">
            <label className="block text-xs uppercase tracking-wide mb-1">Thema</label>
            <input
              className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-neutral-800"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="z. B. Muskelaufbau"
            />
          </div>
          <div className="col-span-1 md:col-span-1">
            <label className="block text-xs uppercase tracking-wide mb-1">Nische</label>
            <input
              className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-neutral-800"
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              placeholder="z. B. fitness, beauty, coding"
            />
          </div>
          <div className="col-span-1 md:col-span-1">
            <label className="block text-xs uppercase tracking-wide mb-1">Ton</label>
            <select
              className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-neutral-800"
              value={tone}
              onChange={(e) => setTone(e.target.value)}
            >
              <option value="locker">locker</option>
              <option value="seriös">seriös</option>
              <option value="motiviert">motiviert</option>
              <option value="sachlich">sachlich</option>
            </select>
          </div>
        </div>

        <button
          disabled={!canGenerate || loading}
          onClick={generate}
          className={
            "px-4 py-2 rounded-xl border font-medium " +
            (loading || !canGenerate
              ? "opacity-50 cursor-not-allowed"
              : "bg-black text-white dark:bg-white dark:text-black")
          }
        >
          {loading ? "Generiere…" : "Generieren"}
        </button>

        {error && (
          <div className="mt-4 p-3 rounded-lg border border-red-400 text-red-700 bg-red-50 dark:bg-transparent">
            Fehler: {error}
          </div>
        )}

        {/* Ergebnisse */}
        <div className="mt-6 grid gap-3">
          {variants.map((v, i) => (
            <div key={i} className="p-3 rounded-xl border bg-white dark:bg-neutral-800">
              <div className="flex items-start justify-between gap-3">
                <pre className="whitespace-pre-wrap font-sans text-sm">{v}</pre>
                <button
                  onClick={() => copy(v)}
                  className="shrink-0 px-3 py-1 rounded-lg border text-sm hover:opacity-80"
                >
                  Kopieren
                </button>
              </div>
            </div>
          ))}
          {!loading && variants.length === 0 && (
            <div className="p-4 rounded-xl border text-sm opacity-70">
              Noch nichts generiert. Wähle oben Typ & fülle das Formular aus.
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
