import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "./lib/supabaseClient";
import Auth from "./Auth";
import Settings from "./Settings";
import Planner from "./Planner";
import Landing from "./Landing";
import Onboarding from "./Onboarding";

const RAW_API_BASE = import.meta.env.VITE_API_BASE as string;
const API_BASE = (RAW_API_BASE || "").replace(/\/+$/, "");
const api = (path: string) => `${API_BASE}${path}`;

type GenType = "hook" | "script" | "caption" | "hashtags";
type Session = Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"];
type GenRow = {
  id: number;
  type: string;
  input: any;
  output: string;
  created_at: string;
  favorite: boolean;
};
type Credits = { limit: number; used: number; remaining: number; authenticated: boolean };

/** Debounce-Hook für Suche */
function useDebounced<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/** Query/LocalStorage Flags */
const DISABLE_ONBOARDING =
  (typeof window !== "undefined" &&
    (new URLSearchParams(window.location.search).get("noob") === "1" ||
      localStorage.getItem("disableOnboarding") === "1")) ||
  false;

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

  // Toggles
  const [showSettings, setShowSettings] = useState(false);
  const [showPlanner, setShowPlanner] = useState(false);

  // Engine- & Tokens-Anzeige
  const [engine, setEngine] = useState<string>("—");
  const [tokenInfo, setTokenInfo] = useState<{ prompt?: number; completion?: number; total?: number }>({});

  // Onboarding (opt-in, NICHT automatisch)
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Library-Filter & Suche
  const [libSearch, setLibSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "hook" | "script" | "caption" | "hashtags">("all");
  const [favOnly, setFavOnly] = useState(false);
  const [libLoading, setLibLoading] = useState(false);
  const debouncedSearch = useDebounced(libSearch, 300);

  // ---- Helper: Headers bauen ----
  const buildHeaders = useCallback(
    (includeJson = false): HeadersInit => {
      const h: Record<string, string> = {};
      if (includeJson) h["Content-Type"] = "application/json";
      if (accessToken) h["Authorization"] = `Bearer ${accessToken}`;
      return h;
    },
    [accessToken]
  );

  // ---- Fetch-Helper ----
  const fetchJSON = useCallback(
    async (url: string, init?: RequestInit) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 30000); // 30s
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
    return () => sub?.subscription?.unsubscribe?.();
  }, []);

  // E-Mail des Users in users_public upserten (→ setze onboarding_done TRUE)
  useEffect(() => {
    const upsertEmail = async () => {
      if (!session?.user) return;
      await supabase
        .from("users_public")
        .upsert(
          { user_id: session.user.id, email: session.user.email, onboarding_done: true },
          { onConflict: "user_id" }
        );
    };
    upsertEmail().catch(() => {});
  }, [session]);

  // Onboarding-Flag NICHT automatisch öffnen (nur Info laden, falls du es später nutzen willst)
  useEffect(() => {
    (async () => {
      if (!session?.user) return;
      const { error } = await supabase
        .from("users_public")
        .select("onboarding_done")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (!error) {
        // nur Info – kein automatisches Öffnen
        // wenn du testen willst: setShowOnboarding(!DISABLE_ONBOARDING && data?.onboarding_done === false);
      }
    })().catch(() => {});
  }, [session]);

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

  // ---- Library laden (mit Filtern/Suche) ----
  const loadLibrary = useCallback(async () => {
    if (!session) return;
    setLibLoading(true);
    try {
      let q = supabase
        .from("generations")
        .select("id,type,input,output,created_at,favorite")
        .order("created_at", { ascending: false })
        .limit(50);

      if (typeFilter !== "all") q = q.eq("type", typeFilter);
      if (favOnly) q = q.eq("favorite", true);

      const s = debouncedSearch.trim();
      if (s) {
        const safe = s.replace(/%/g, "\\%").replace(/_/g, "\\_");
        q = q.or(`output.ilike.%${safe}%,input->>topic.ilike.%${safe}%`);
      }

      const { data, error } = await q;
      if (!error && data) setLibrary(data as any);
    } finally {
      setLibLoading(false);
    }
  }, [session, typeFilter, favOnly, debouncedSearch]);

  useEffect(() => {
    loadLibrary();
  }, [loadLibrary]);

  // Bei Filter/Suche zusätzlich neu laden
  useEffect(() => {
    loadLibrary();
  }, [typeFilter, favOnly, debouncedSearch, loadLibrary]);

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

      // Engine & Tokens aus Response-Headern lesen (falls vorhanden)
      const engHeader = res.headers.get("X-Engine");
      if (engHeader) setEngine(engHeader === "llm" ? "LLM (Grok 4 Fast)" : "Local");

      const tPrompt = Number(res.headers.get("X-Tokens-Prompt") || 0);
      const tComp = Number(res.headers.get("X-Tokens-Completion") || 0);
      const tTotal = Number(res.headers.get("X-Tokens-Total") || 0);
      if (!Number.isNaN(tTotal)) setTokenInfo({ prompt: tPrompt, completion: tComp, total: tTotal });

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
      if (!engHeader && data?.engine) {
        setEngine(data.engine === "llm" ? "LLM (Grok 4 Fast)" : "Local");
      }

      setVariants((data?.variants ?? []) as string[]);
      fetchCredits().catch(() => {});
      return;
    } catch (e: any) {
      // 2) Fallback: GET ohne Token (kein Preflight, keine Credits)
      try {
        const params = new URLSearchParams({ type, topic, niche, tone });
        const url = `${api("/api/v1/generate_simple")}?${params.toString()}`;

        const data = await fetchJSON(url, { headers: buildHeaders(false) });
        setVariants((data?.variants ?? []) as string[]);
        setEngine("Local (Fallback)");
        setTokenInfo({});
        setNetHint("Hinweis: Fallback-Route genutzt (keine Credits abgezogen). POST-Debug folgt.");
        return;
      } catch (e2: any) {
        const msg = e2?.message || (e as any)?.message || "Fehler bei der Generierung";
        setError(msg);
        if (msg.includes("Netzwerk") || msg.includes("CORS") || msg.includes("VITE_API_BASE")) {
          setNetHint(
            `Debug:
- API_BASE: ${API_BASE}
- Öffne ${api("/health")} im Browser (soll {"ok":true,"version":"0.3.8"} zeigen).
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
        const uid = session.user.id; // RLS
        const { error } = await supabase.from("generations").insert({
          user_id: uid, // RLS-konform
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

  // Favoriten-Toggle
  const toggleFavorite = useCallback(async (row: GenRow) => {
    try {
      const { error } = await supabase.from("generations").update({ favorite: !row.favorite }).eq("id", row.id);
      if (error) throw error;
      setLibrary((prev) => prev.map((r) => (r.id === row.id ? { ...r, favorite: !r.favorite } : r)));
    } catch (e: any) {
      alert(e?.message || "Favorit konnte nicht geändert werden.");
    }
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setLibrary([]);
    setCredits({ limit: 0, used: 0, remaining: 0, authenticated: false });
    setEngine("—");
    setTokenInfo({});
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

  const EngineBadge = () => <span className="px-2 py-1 rounded-lg border text-xs">Engine: {engine}</span>;

  const TokensBadge = () => (
    <span className="px-2 py-1 rounded-lg border text-xs">Tokens: {tokenInfo.total ?? 0}</span>
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
          <Landing
            onSignup={() => {
              const authEl = document.getElementById("auth-root");
              if (authEl) authEl.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          />
          <div id="auth-root">
            <Auth />
          </div>
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
          <EngineBadge />
          <TokensBadge />
          <button onClick={() => setShowPlanner((s) => !s)} className="px-3 py-1 rounded-lg border text-sm">
            {showPlanner ? "Close Planner" : "Planner"}
          </button>
          <button onClick={() => setShowSettings((s) => !s)} className="px-3 py-1 rounded-lg border text-sm">
            {showSettings ? "Close Settings" : "Settings"}
          </button>
          {/* Onboarding bewusst nur manuell öffnen */}
          {!DISABLE_ONBOARDING && (
            <button onClick={() => setShowOnboarding(true)} className="px-3 py-1 rounded-lg border text-sm">
              Onboarding
            </button>
          )}
          <CreditBadge />
          <button onClick={logout} className="px-3 py-1 rounded-lg border text-sm">
            Logout
          </button>
        </div>
      </header>

      {/* Onboarding-Modal – nur manuell, nie automatisch */}
      {showOnboarding && <Onboarding onDone={() => setShowOnboarding(false)} />}

      <main className="max-w-4xl mx-auto px-4 pb-24">
        {/* Settings-Panel */}
        {showSettings && (
          <div className="mb-6">
            <Settings />
          </div>
        )}

        {/* Planner-Panel */}
        {showPlanner && (
          <div className="mb-6">
            <Planner />
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
                  {/* Optional: direkt als Favorit speichern */}
                  <button
                    onClick={async () => {
                      if (!session) return alert("Bitte einloggen.");
                      setBusySaveId(1);
                      try {
                        const uid = session.user.id; // RLS
                        const { error } = await supabase.from("generations").insert({
                          user_id: uid, // RLS-konform
                          type,
                          input: { topic, niche, tone },
                          output: v,
                          favorite: true,
                        });
                        if (error) throw error;
                        await loadLibrary();
                        alert("Als Favorit gespeichert ✅");
                        await supabase.from("usage_log").insert({ event: "save", meta: { type, favorite: true } });
                      } catch (e: any) {
                        alert(e?.message || "Speichern fehlgeschlagen");
                      } finally {
                        setBusySaveId(null);
                      }
                    }}
                    disabled={busySaveId !== null}
                    className="shrink-0 px-3 py-1 rounded-lg border text-sm hover:opacity-80"
                    title="Speichern & als Favorit markieren"
                  >
                    {busySaveId !== null ? "Speichere…" : "Speichern ★"}
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

        {/* Library-Filter */}
        <div className="mt-10 mb-3 p-3 rounded-xl border bg-white dark:bg-neutral-800">
          <div className="grid md:grid-cols-4 gap-3 items-end">
            <div className="md:col-span-2">
              <label className="block text-xs uppercase tracking-wide mb-1">Suche (Topic/Output)</label>
              <input
                className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-neutral-900"
                value={libSearch}
                onChange={(e) => setLibSearch(e.target.value)}
                placeholder="z. B. Muskelaufbau oder 'Hook Formel'"
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wide mb-1">Typ</label>
              <select
                className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-neutral-900"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as any)}
              >
                <option value="all">Alle</option>
                <option value="hook">Hooks</option>
                <option value="script">Skripte</option>
                <option value="caption">Captions</option>
                <option value="hashtags">Hashtags</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <input id="favOnly" type="checkbox" checked={favOnly} onChange={(e) => setFavOnly(e.target.checked)} />
              <label htmlFor="favOnly" className="text-sm">
                Nur Favoriten
              </label>
            </div>
          </div>
        </div>

        {/* Library */}
        <h2 className="text-lg font-semibold mb-2">Meine Library</h2>
        <button onClick={loadLibrary} className="mb-2 px-3 py-1 rounded-lg border text-sm" disabled={libLoading}>
          {libLoading ? "Lade…" : "Neu laden"}
        </button>
        <div className="text-xs opacity-70 mb-3">
          {library.length} Ergebnisse {libLoading && "• lädt…"}
        </div>

        <div className="grid gap-3">
          {library.map((row) => (
            <div key={row.id} className="p-3 rounded-xl border bg-white dark:bg-neutral-800">
              {/* Header mit Star-Toggle */}
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs opacity-70">
                  {row.type.toUpperCase()} • {new Date(row.created_at).toLocaleString()}
                </div>
                <button
                  onClick={() => toggleFavorite(row)}
                  title={row.favorite ? "Als Nicht-Favorit markieren" : "Als Favorit markieren"}
                  className={
                    "px-2 py-1 rounded-lg border text-xs " + (row.favorite ? "bg-yellow-200 dark:bg-yellow-600" : "")
                  }
                >
                  {row.favorite ? "★ Favorit" : "☆ Favorit"}
                </button>
              </div>

              <div className="text-xs opacity-70 mb-2">
                {row.input?.topic} • {row.input?.niche} • {row.input?.tone}
              </div>
              <pre className="whitespace-pre-wrap font-sans text-sm">{row.output}</pre>
            </div>
          ))}
          {library.length === 0 && (
            <div className="p-4 rounded-xl border text-sm opacity-70">
              Keine Ergebnisse. Passe Filter/Suche an oder speichere neue Varianten.
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
