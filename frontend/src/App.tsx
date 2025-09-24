import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "./lib/supabaseClient";
import Auth from "./Auth";
import Settings from "./Settings";

const RAW_API_BASE = import.meta.env.VITE_API_BASE as string;
const API_BASE = (RAW_API_BASE || "").replace(/\/+$/, "");
const api = (path: string) => `${API_BASE}${path}`;

type GenType = "hook" | "script" | "caption" | "hashtags";
type Session = Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"];
type GenRow = { id: number; type: string; input: any; output: string; created_at: string };
type Credits = { limit: number; used: number; remaining: number; authenticated: boolean };

export default function App() {
  const [session, setSession] = useState<Session>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  const [type, setType] = useState<GenType>("hook");
  const [topic, setTopic] = useState("Muskelaufbau");
  const [niche, setNiche] = useState("fitness");
  const [tone, setTone] = useState("locker");

  const [loading, setLoading] = useState(false);
  const [variants, setVariants] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [netHint, setNetHint] = useState<string | null>(null);
  const [warm, setWarm] = useState(false);

  const [library, setLibrary] = useState<GenRow[]>([]);
  const [busySaveId, setBusySaveId] = useState<number | null>(null);

  const [credits, setCredits] = useState<Credits>({ limit: 0, used: 0, remaining: 0, authenticated: false });

  // NEW: Settings Toggle
  const [showSettings, setShowSettings] = useState(false);

  // ---- Helper: Headers immer als Record<string,string> bauen ----
  const buildHeaders = useCallback(
    (includeJson = false): HeadersInit => {
      const h: Record<string, string> = {};
      if (includeJson) h["Content-Type"] = "application/json";
      if (accessToken) h["Authorization"] = `Bearer ${accessToken}`;
      return h;
    },
    [accessToken]
  );

  // ---- Fetch-Helper mit Timeout + klaren Fehlermeldungen ----
  const fetchJSON = useCallback(
    async (url: string, init?: RequestInit) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      try {
        const res = await fetch(url, { cache: "no-store", ...init, signal: ctrl.signal });
        const txt = await res.text().catch(() => "");
        if (!res.ok) {
          try {
            const j = txt ? JSON.parse(txt) : {};
            throw new Error(j?.detail || j?.message || `HTTP ${res.status}: ${res.statusText}`);
          } catch {
            throw new Error(txt || `HTTP ${res.status}: ${res.statusText}`);
          }
        }
        return txt ? JSON.parse(txt) : {};
      } catch (e: any) {
        if (e?.name === "AbortError") throw new Error("Netzwerk-Timeout. Backend erreichbar?");
        if (e?.message?.includes("Failed to fetch") || e?.name === "TypeError") {
          throw new Error("Netzwerk/CORS-Problem: Prüfe VITE_API_BASE (https) & CORS am Backend.");
        }
        throw e;
      } finally {
        clearTimeout(t);
      }
    },
    []
  );

  // ---- Auth Lifecycle ----
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAccessToken(data.session?.access_token || null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setAccessToken(s?.access_token || null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // ---- Warmup ----
  const warmup = useCallback(async () => {
    setNetHint(null);
    try {
      await fetchJSON(api("/health"));
      setWarm(true);
    } catch (e: any) {
      setWarm(false);
      setNetHint(e?.message || "Health-Check fehlgeschlagen.");
    }
  }, [fetchJSON]);

  useEffect(() => {
    if (!API_BASE) {
      setNetHint("VITE_API_BASE fehlt. In Vercel/Env setzen.");
      return;
    }
    warmup();
  }, [warmup]);

  // ---- Credits laden ----
  const fetchCredits = useCallback(async () => {
    if (!accessToken) {
      setCredits({ limit: 0, used: 0, remaining: 0, authenticated: false });
      return;
    }
    try {
      const data = await fetchJSON(api("/api/v1/credits"), { headers: buildHeaders() });
      setCredits({
        limit: data?.limit ?? 0,
        used: data?.used ?? 0,
        remaining: data?.remaining ?? 0,
        authenticated: !!data?.authenticated,
      });
    } catch (e: any) {
      setNetHint(e?.message || "Credits konnten nicht geladen werden.");
      setCredits((c) => ({ ...c, authenticated: !!accessToken }));
    }
  }, [accessToken, buildHeaders, fetchJSON]);

  useEffect(() => {
    fetchCredits();
  }, [fetchCredits]);

  // ---- Library laden ----
  const loadLibrary = useCallback(async () => {
    if (!session) return;
    const { data, error } = await supabase
      .from("generations")
      .select("id,type,input,output,created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (!error && data) setLibrary(data as any);
  }, [session]);

  useEffect(() => {
    loadLibrary();
  }, [loadLibrary]);

  // ---- Aktionen ----
  const canGenerate = useMemo(
    () => topic.trim().length > 1 && niche.trim().length > 0 && tone.trim().length > 0,
    [topic, niche, tone]
  );

  const generate = useCallback(async () => {
    if (!canGenerate) return;
    setLoading(true);
    setError(null);
    setNetHint(null);
    setVariants([]);
    try {
      // 1) normaler POST (mit Token, Credits)
      const res = await fetch(api("/api/v1/generate"), {
        method: "POST",
        headers: buildHeaders(true),
        body: JSON.stringify({ type, topic, niche, tone }),
      });

      if (res.status === 429) {
        const j = await res.json().catch(() => ({ detail: "Monatslimit erreicht" }));
        throw new Error(j?.detail || "Monatslimit erreicht");
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        try {
          const j = text ? JSON.parse(text) : {};
          throw new Error(j?.detail || j?.message || `HTTP ${res.status}: ${res.statusText}`);
        } catch {
          throw new Error(text || `HTTP ${res.status}: ${res.statusText}`);
        }
      }

      const data = await res.json();
      setVariants((data?.variants ?? []) as string[]);
      fetchCredits().catch(() => {});
      return;
    } catch (e: any) {
      // 2) Fallback: GET ohne Token (kein Preflight, keine Credits)
      try {
        const url = new URL(api("/api/v1/generate_simple"));
        url.searchParams.set("type", type);
        url.searchParams.set("topic", topic);
        url.searchParams.set("niche", niche);
        url.searchParams.set("tone", tone);

        const data = await fetchJSON(url.toString(), { headers: buildHeaders(false) });
        setVariants((data?.variants ?? []) as string[]);
        // Hinweis, dass Fallback aktiv war
        setNetHint("Hinweis: Fallback-Route genutzt (keine Credits abgezogen). POST-Debug folgt.");
        return;
      } catch (e2: any) {
        const msg = e2?.message || e?.message || "Fehler bei der Generierung";
        setError(msg);
        if (msg.includes("Netzwerk") || msg.includes("CORS") || msg.includes("VITE_API_BASE")) {
          setNetHint(
            `Debug:
- API_BASE: ${API_BASE}
- Öffne ${api("/health")} im Browser (soll {"ok":true,"version":"0.3.4"} zeigen).
- Falls POST weiterhin blockiert, nutzen wir vorerst GET /generate_simple.`
          );
        }
      }
    } finally {
      setLoading(false);
    }
  }, [canGenerate, type, topic, niche, tone, buildHeaders, fetchCredits, fetchJSON]);

  const saveToLibrary = useCallback(
    async (variant: string) => {
      if (!session) {
        alert("Bitte zuerst einloggen, um zu speichern.");
        return;
      }
      setBusySaveId(1);
      try {
        const { error } = await supabase.from("generations").insert({
          type,
          input: { topic, niche, tone },
          output: variant,
        });
        if (error) throw error;
        await loadLibrary();
        alert("Gespeichert ✅");
        await supabase.from("usage_log").insert({ event: "save", meta: { type } });
      } catch (e: any) {
        alert(e?.message || "Speichern fehlgeschlagen");
      } finally {
        setBusySaveId(null);
      }
    },
    [session, type, topic, niche, tone, loadLibrary]
  );

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setLibrary([]);
    setCredits({ limit: 0, used: 0, remaining: 0, authenticated: false });
  }, []);

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

  const CreditBadge = () => (
    <span className="px-2 py-1 rounded-lg border text-xs">
      Credits: {credits.used}/{credits.limit} • Rest: {credits.remaining}
    </span>
  );

  // ---- UI ----
  if (!session) {
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100">
        <header className="max-w-4xl mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold">Creator AI – Shortform Generator</h1>
          <p className="text-sm opacity-70">{warm ? "Backend bereit ✅" : "Backend wecken…"} • API: {API_BASE || "—"}</p>
          {!warm && (
            <button onClick={warmup} className="mt-2 px-3 py-1 rounded-lg border text-sm">
              Erneut prüfen
            </button>
          )}
        </header>
        <main className="max-w-4xl mx-auto px-4 pb-24">
          <Auth />
          {(error || netHint) && (
            <div className="mt-6 p-4 rounded-xl border text-sm">
              {error && <div className="mb-2 text-red-600">Fehler: {error}</div>}
              {netHint && <pre className="whitespace-pre-wrap opacity-80">{netHint}</pre>}
            </div>
          )}
          <div className="mt-6 p-4 rounded-xl border text-sm opacity-80">
            Tipp: Registriere dich (E-Mail/Passwort) und logge dich ein. Danach kannst du Entwürfe speichern & Credits
            nutzen.
          </div>
        </main>
      </div>
    );
  }

  const limitReached = credits.authenticated && credits.limit > 0 && credits.remaining <= 0;

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100">
      <header className="max-w-4xl mx-auto px-4 py-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Creator AI – Shortform Generator</h1>
          <p className="text-sm opacity-70">
            {warm ? "Backend bereit ✅" : "Backend wecken…"} • Eingeloggt als {session.user.email} • API: {API_BASE || "—"}
          </p>
          {!warm && (
            <button onClick={warmup} className="mt-2 px-3 py-1 rounded-lg border text-sm">
              Backend prüfen
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* NEW: Settings-Button im Header */}
          <button onClick={() => setShowSettings((s) => !s)} className="px-3 py-1 rounded-lg border text-sm">
            {showSettings ? "Close Settings" : "Settings"}
          </button>
          <CreditBadge />
          <button onClick={logout} className="px-3 py-1 rounded-lg border text-sm">
            Logout
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 pb-24">
        {/* NEW: Settings-Panel über den Tabs */}
        {showSettings && (
          <div className="mb-6">
            <Settings />
          </div>
        )}

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
            <input
              className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-neutral-800"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="z. B. Muskelaufbau"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wide mb-1">Nische</label>
            <input
              className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-neutral-800"
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              placeholder="z. B. fitness, beauty, coding"
            />
          </div>
          <div>
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
          disabled={!canGenerate || loading || limitReached}
          onClick={generate}
          className={
            "px-4 py-2 rounded-xl border font-medium " +
            (loading || !canGenerate || limitReached
              ? "opacity-50 cursor-not-allowed"
              : "bg-black text-white dark:bg-white dark:text-black")
          }
        >
          {limitReached ? "Limit erreicht" : loading ? "Generiere…" : "Generieren"}
        </button>

        {error && (
          <div className="mt-4 p-3 rounded-lg border border-red-400 text-red-700 bg-red-50 dark:bg-transparent">
            Fehler: {error}
            {netHint && <pre className="mt-2 whitespace-pre-wrap text-xs opacity-80">{netHint}</pre>}
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
        <button onClick={loadLibrary} className="mb-3 px-3 py-1 rounded-lg border text-sm">
          Neu laden
        </button>
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
