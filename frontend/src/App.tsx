import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";
import Auth from "./Auth";

const API_BASE = import.meta.env.VITE_API_BASE as string;
type GenType = "hook" | "script" | "caption" | "hashtags";

type Session = Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"];
type GenRow = { id: number; type: string; input: any; output: string; created_at: string };

export default function App() {
  const [session, setSession] = useState<Session>(null);
  const [type, setType] = useState<GenType>("hook");
  const [topic, setTopic] = useState("Muskelaufbau");
  const [niche, setNiche] = useState("fitness");
  const [tone, setTone] = useState("locker");
  const [loading, setLoading] = useState(false);
  const [variants, setVariants] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [warm, setWarm] = useState(false);
  const [library, setLibrary] = useState<GenRow[]>([]);
  const [busySaveId, setBusySaveId] = useState<number | null>(null);

  // Session-Listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Backend warm pingen
  useEffect(() => {
    fetch(`${API_BASE}/health`).then(()=>setWarm(true)).catch(()=>setWarm(false));
  }, []);

  const canGenerate = useMemo(
    () => topic.trim().length > 1 && niche.trim().length > 0 && tone.trim().length > 0,
    [topic, niche, tone]
  );

  const generate = async () => {
    if (!canGenerate) return;
    setLoading(true); setError(null); setVariants([]);
    try {
      const res = await fetch(`${API_BASE}/api/v1/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, topic, niche, tone }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setVariants((data?.variants ?? []) as string[]);
      if (session) {
        // Usage-Log (optional)
        await supabase.from("usage_log").insert({ event: "generate" });
      }
    } catch (e: any) {
      setError(e?.message || "Fehler bei der Generierung");
    } finally {
      setLoading(false);
    }
  };

  const saveToLibrary = async (variant: string) => {
    if (!session) { alert("Bitte zuerst einloggen, um zu speichern."); return; }
    setBusySaveId(1); // nur UI spinner
    try {
      const { error } = await supabase.from("generations").insert({
        type,
        input: { topic, niche, tone },
        output: variant,
      });
      if (error) throw error;
      await loadLibrary();
      alert("Gespeichert ✅");
      // Usage-Log
      await supabase.from("usage_log").insert({ event: "save", meta: { type } });
    } catch (e: any) {
      alert(e.message || "Speichern fehlgeschlagen");
    } finally {
      setBusySaveId(null);
    }
  };

  const loadLibrary = async () => {
    if (!session) return;
    const { data, error } = await supabase
      .from("generations")
      .select("id,type,input,output,created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (!error && data) setLibrary(data as any);
  };

  useEffect(() => { loadLibrary(); }, [session]);

  const logout = async () => { await supabase.auth.signOut(); setLibrary([]); };

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

  // Login-Gate
  if (!session) {
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100">
        <header className="max-w-4xl mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold">Creator AI – Shortform Generator</h1>
          <p className="text-sm opacity-70">
            {warm ? "Backend bereit ✅" : "Backend wecken…"} • API: {API_BASE}
          </p>
        </header>
        <main className="max-w-4xl mx-auto px-4 pb-24">
          <Auth />
          <div className="mt-6 p-4 rounded-xl border text-sm opacity-80">
            Tipp: Registriere dich (E-Mail/Passwort) und logge dich ein. Danach kannst du Entwürfe speichern.
          </div>
        </main>
      </div>
    );
  }

  // App-UI
  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100">
      <header className="max-w-4xl mx-auto px-4 py-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Creator AI – Shortform Generator</h1>
          <p className="text-sm opacity-70">
            {warm ? "Backend bereit ✅" : "Backend wecken…"} • Eingeloggt als {session.user.email}
          </p>
        </div>
        <button onClick={logout} className="px-3 py-1 rounded-lg border text-sm">Logout</button>
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
          <div>
            <label className="block text-xs uppercase tracking-wide mb-1">Thema</label>
            <input className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-neutral-800"
                   value={topic} onChange={(e)=>setTopic(e.target.value)} placeholder="z. B. Muskelaufbau" />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wide mb-1">Nische</label>
            <input className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-neutral-800"
                   value={niche} onChange={(e)=>setNiche(e.target.value)} placeholder="z. B. fitness, beauty, coding" />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wide mb-1">Ton</label>
            <select className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-neutral-800"
                    value={tone} onChange={(e)=>setTone(e.target.value)}>
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
            (loading || !canGenerate ? "opacity-50 cursor-not-allowed"
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
                <div className="flex gap-2">
                  <button
                    onClick={() => navigator.clipboard.writeText(v)}
                    className="shrink-0 px-3 py-1 rounded-lg border text-sm hover:opacity-80"
                  >
                    Kopieren
                  </button>
                  <button
                    onClick={() => saveToLibrary(v)}
                    disabled={busySaveId !== null}
                    className="shrink-0 px-3 py-1 rounded-lg border text-sm hover:opacity-80"
                  >
                    {busySaveId !== null ? "Speichere…" : "Speichern"}
                  </button>
                </div>
              </div>
            </div>
          ))}
          {!loading && variants.length === 0 && (
            <div className="p-4 rounded-xl border text-sm opacity-70">
              Noch nichts generiert. Wähle oben Typ & fülle das Formular aus.
            </div>
          )}
        </div>

        {/* Library */}
        <h2 className="text-lg font-semibold mt-10 mb-2">Meine Library</h2>
        <button onClick={loadLibrary} className="mb-3 px-3 py-1 rounded-lg border text-sm">Neu laden</button>
        <div className="grid gap-3">
          {library.map((row) => (
            <div key={row.id} className="p-3 rounded-xl border bg-white dark:bg-neutral-800">
              <div className="text-xs opacity-70 mb-1">
                {row.type.toUpperCase()} • {new Date(row.created_at).toLocaleString()}
              </div>
              <div className="text-xs opacity-70 mb-2">
                {row.input?.topic} • {row.input?.niche} • {row.input?.tone}
              </div>
              <pre className="whitespace-pre-wrap font-sans text-sm">{row.output}</pre>
            </div>
          ))}
          {library.length === 0 && (
            <div className="p-4 rounded-xl border text-sm opacity-70">
              Noch nichts gespeichert. Speichere eine Variante aus den Ergebnissen.
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
