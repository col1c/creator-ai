// src/App.tsx
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import { supabase } from "./lib/supabaseClient";
import Auth from "./Auth";
import Settings from "./Settings";
import Planner from "./Planner";
import Landing from "./Landing";
import Onboarding from "./Onboarding";

/* NEU: Templates-Seite (CRUD + Apply) */
import Templates from "./Templates";

/* NEU: UI-Polish Components */
import CopyButton from "./components/CopyButton";
import CreditsBadge from "./components/CreditsBadge";
import EmptyState from "./components/EmptyState";
import LoadingCard from "./components/LoadingCard";

/* NEU: Dashboard „Daily-3“ */
import DashboardDaily3 from "./components/DashboardDaily3";

/* NEU: Statische Seiten */
import Privacy from "./pages/Privacy";
import Imprint from "./pages/Imprint";

/* NEU: Streaming + Command-Palette (RELATIVE IMPORTS!) */
import GenerateStream from "./components/GenerateStream";
import CmdPalette from "./components/CmdPalette";

/* NEU: WebSocket-Streaming */
import GenerateWS from "./components/GenerateWS";

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

/** Debounce-Hook */
function useDebounced<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/** Hilfen zum sauberen Aufteilen */
function splitListString(s: string): string[] {
  const txt = (s || "").replace(/\r\n/g, "\n").trim();
  if (!txt) return [];
  let work = txt.replace(/[•●▪︎·]/g, "\n").replace(/\n[ \t]*[-–—]\s*/g, "\n");
  if (work.includes("\n")) {
    return work.split(/\n+/).map((x) => x.replace(/^[\-\–—•●]\s*/, "").trim()).filter(Boolean);
  }
  let parts = work.split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ0-9])/);
  if (parts.length > 1) return parts.map((p) => p.trim()).filter(Boolean);
  const commaParts = work.split(/,\s+(?=[A-ZÄÖÜ0-9])/);
  if (commaParts.length >= 2) return commaParts.map((p) => p.trim()).filter(Boolean);
  return [txt];
}

/** Egal was vom Backend kommt → Array<string> */
function normalizeVariants(v: unknown): string[] {
  try {
    if (Array.isArray(v)) {
      const flat = (v as any[]).flat();
      const list: string[] = [];
      for (const item of flat) {
        if (typeof item === "string") list.push(item);
        else if (item && typeof item === "object") {
          const anyItem = item as any;
          const cand =
            (typeof anyItem.text === "string" && anyItem.text) ||
            (typeof anyItem.content === "string" && anyItem.content) ||
            (typeof anyItem.output === "string" && anyItem.output) ||
            "";
          list.push(cand || JSON.stringify(item));
        } else if (item != null) list.push(String(item));
      }
      if (list.length === 1) {
        const sub = splitListString(list[0]);
        if (sub.length > 1) return sub;
      }
      return list.map((s) => s.trim()).filter(Boolean);
    }
    if (typeof v === "string") {
      const arr = splitListString(v);
      return arr.length ? arr : [v.trim()];
    }
    if (v && typeof v === "object") {
      const anyV = v as any;
      const s =
        (typeof anyV.text === "string" && anyV.text) ||
        (typeof anyV.content === "string" && anyV.content) ||
        (typeof anyV.output === "string" && anyV.output) ||
        "";
      return splitListString(String(s));
    }
    return [];
  } catch {
    return [];
  }
}

/** Onboarding nie auto */
const DISABLE_ONBOARDING =
  (typeof window !== "undefined" &&
    (new URLSearchParams(window.location.search).get("noob") === "1" ||
      localStorage.getItem("disableOnboarding") === "1")) ||
  false;

/* -------------------------------------------
   Deine bisherige App als eigene Komponente
   ------------------------------------------- */
function HomeApp() {
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

  const [showSettings, setShowSettings] = useState(false);
  const [showPlanner, setShowPlanner] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showDashboard, setShowDashboard] = useState(true); // NEU

  const [engine, setEngine] = useState<string>("—");
  const [tokenInfo, setTokenInfo] = useState<{ prompt?: number; completion?: number; total?: number }>({});
  const [isCached, setIsCached] = useState(false); // zeigt X-Cache: HIT

  const [showOnboarding, setShowOnboarding] = useState(false);

  const [libSearch, setLibSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "hook" | "script" | "caption" | "hashtags">("all");
  const [favOnly, setFavOnly] = useState(false);
  const [libLoading, setLibLoading] = useState(false);
  const debouncedSearch = useDebounced(libSearch, 300);

  const lastReq = useRef<string>(""); // Doppel-Submit vermeiden

  const buildHeaders = useCallback(
    (includeJson = false): HeadersInit => {
      const h: Record<string, string> = {};
      if (includeJson) h["Content-Type"] = "application/json";
      if (accessToken) h["Authorization"] = `Bearer ${accessToken}`;
      return h;
    },
    [accessToken]
  );

  const fetchJSON = useCallback(
    async (url: string, init?: RequestInit) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 30000);
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

  // Auth
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

  // users_public upserten (onboarding_done direkt true)
  useEffect(() => {
    const upsertEmail = async () => {
      if (!session?.user) return;
      await supabase
        .from("users_public")
        .upsert({ user_id: session.user.id, email: session.user.email, onboarding_done: true }, { onConflict: "user_id" });
    };
    upsertEmail().catch(() => {});
  }, [session]);

  // Warmup
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

  // Credits
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

  // Prefill aus Templates.Apply
  useEffect(() => {
    try {
      const raw = localStorage.getItem("creatorai_prefill");
      if (!raw) return;
      const p = JSON.parse(raw);
      if (p.type) setType(p.type);
      if (typeof p.topic === "string") setTopic(p.topic);
      if (typeof p.niche === "string") setNiche(p.niche);
      if (typeof p.tone === "string") setTone(p.tone);
    } catch {}
    finally {
      localStorage.removeItem("creatorai_prefill");
      setShowTemplates(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);

  // Library
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

  useEffect(() => {
    loadLibrary();
  }, [typeFilter, favOnly, debouncedSearch, loadLibrary]);

  // Generate
  const canGenerate = useMemo(
    () => topic.trim().length > 1 && niche.trim().length > 0 && tone.trim().length > 0,
    [topic, niche, tone]
  );

  const doGenerate = useCallback(
    async (force = false) => {
      if (!canGenerate) return;
      const fingerprint = JSON.stringify({ type, topic, niche, tone, force });
      if (loading || fingerprint === lastReq.current) return;
      lastReq.current = fingerprint;

      setLoading(true);
      setError(null);
      setNetHint(null);
      setVariants([]);
      setIsCached(false);

      try {
        const url = `${api("/api/v1/generate")}${force ? "?force=1" : ""}`;
        const res = await fetch(url, {
          method: "POST",
          headers: buildHeaders(true),
          body: JSON.stringify({ type, topic, niche, tone }),
        });

        const engHeader = res.headers.get("X-Engine");
        if (engHeader) setEngine(engHeader === "llm" ? "LLM (Grok 4 Fast)" : engHeader);

        const tPrompt = Number(res.headers.get("X-Tokens-Prompt") || 0);
        const tComp = Number(res.headers.get("X-Tokens-Completion") || 0);
        const tTotal = Number(res.headers.get("X-Tokens-Total") || 0);
        if (!Number.isNaN(tTotal)) setTokenInfo({ prompt: tPrompt, completion: tComp, total: tTotal });

        const cacheHdr = res.headers.get("X-Cache");
        setIsCached(cacheHdr === "HIT");

        if (res.status === 429) {
          const j = await res.json().catch(() => ({ detail: "Monatslimit erreicht" }));
          throw new Error(j?.detail || "Monatslimit erreicht");
        }

        const text = await res.text().catch(() => "");
        const data = text ? JSON.parse(text) : {};
        if (!res.ok) throw new Error(data?.detail || data?.message || `HTTP ${res.status}: ${res.statusText}`);

        const arr = normalizeVariants(data?.variants ?? data?.output ?? "");
        setVariants(arr);
        fetchCredits().catch(() => {});
        return;
      } catch (e: any) {
        try {
          const params = new URLSearchParams({ type, topic, niche, tone });
          const url = `${api("/api/v1/generate_simple")}?${params.toString()}`;
          const data = await fetchJSON(url, { headers: buildHeaders(false) });
          const arr = normalizeVariants(data?.variants ?? data?.output ?? "");
          setVariants(arr);
          setEngine("local");
          setTokenInfo({});
          setNetHint("Hinweis: Fallback-Route genutzt (keine Credits abgezogen). POST-Debug folgt.");
          return;
        } catch (e2: any) {
          const msg = e2?.message || e?.message || "Fehler bei der Generierung";
          setError(msg);
          if (msg.includes("Netzwerk") || msg.includes("CORS") || msg.includes("VITE_API_BASE")) {
            setNetHint(
              `Debug:
- API_BASE: ${API_BASE}
- Öffne ${api("/health")} im Browser (soll {"ok":true} zeigen).
- Falls POST blockiert, nutzen wir vorerst GET /generate_simple.`
            );
          }
        }
      } finally {
        setLoading(false);
        setTimeout(() => (lastReq.current = ""), 300);
      }
    },
    [canGenerate, type, topic, niche, tone, buildHeaders, fetchCredits, fetchJSON, loading]
  );

  const onApplyTemplate = useCallback(
    (prefill: { type: "hook" | "script" | "caption"; topic: string; niche: string; tone: string }) => {
      setType(prefill.type as GenType);
      setTopic(prefill.topic || "");
      setNiche(prefill.niche || "");
      setTone(prefill.tone || "");
      setShowTemplates(false);
      setTimeout(() => {
        window.scrollTo({ top: 0, behavior: "smooth" });
        if ((prefill.topic || "").trim().length > 1) {
          doGenerate(false);
        }
      }, 50);
    },
    [doGenerate]
  );

  const saveToLibrary = useCallback(
    async (variant: string) => {
      if (!session) {
        alert("Bitte zuerst einloggen, um zu speichern.");
        return;
      }
      setBusySaveId(1);
      try {
        const uid = session.user.id;
        const { error } = await supabase.from("generations").insert({
          user_id: uid,
          type,
          input: { topic, niche, tone },
          output: variant.trim(),
        });
        if (error) throw error;
        await loadLibrary();
        alert("Gespeichert ✅");
        await supabase.from("usage_log").insert({ user_id: uid, event: "save", meta: { type } });
      } catch (e: any) {
        alert(e?.message || "Speichern fehlgeschlagen");
      } finally {
        setBusySaveId(null);
      }
    },
    [session, type, topic, niche, tone, loadLibrary]
  );

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
    setIsCached(false);
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

  const EngineBadge = () => <span className="px-2 py-1 rounded-lg border text-xs">Engine: {engine}</span>;
  const TokensBadge = () => <span className="px-2 py-1 rounded-lg border text-xs">Tokens: {tokenInfo.total ?? 0}</span>;

  if (!session) {
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100">
        <header className="max-w-4xl mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold">Creator AI – Shortform Generator</h1>
          <p className="text-sm opacity-70">
            {warm ? "Backend bereit ✅" : "Backend wecken…"} • API: {API_BASE || "—"}
          </p>
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
          <CreditsBadge remaining={credits.remaining} cached={isCached} />
          <button onClick={() => setShowDashboard((s) => !s)} className="px-3 py-1 rounded-lg border text-sm">
            {showDashboard ? "Close Dashboard" : "Dashboard"}
          </button>
          <button onClick={() => setShowPlanner((s) => !s)} className="px-3 py-1 rounded-lg border text-sm">
            {showPlanner ? "Close Planner" : "Planner"}
          </button>
          <button onClick={() => setShowTemplates((s) => !s)} className="px-3 py-1 rounded-lg border text-sm">
            {showTemplates ? "Close Templates" : "Templates"}
          </button>
          <button onClick={() => setShowSettings((s) => !s)} className="px-3 py-1 rounded-lg border text-sm">
            {showSettings ? "Close Settings" : "Settings"}
          </button>
          {!DISABLE_ONBOARDING && (
            <button onClick={() => setShowOnboarding(true)} className="px-3 py-1 rounded-lg border text-sm">
              Onboarding
            </button>
          )}
          <button onClick={logout} className="px-3 py-1 rounded-lg border text-sm">
            Logout
          </button>
        </div>
      </header>

      {showOnboarding && <Onboarding onDone={() => setShowOnboarding(false)} />}

      <main className="max-w-4xl mx-auto px-4 pb-24">
        {showSettings && (
          <div className="mb-6">
            <Settings />
          </div>
        )}

        {/* NEU: Dashboard (Daily-3) */}
        {showDashboard && (
          <div className="mb-6">
            <DashboardDaily3 />
          </div>
        )}

        {showPlanner && (
          <div className="mb-6">
            <Planner />
          </div>
        )}
        {showTemplates && (
          <div className="mb-6">
            <Templates onApply={onApplyTemplate} />
          </div>
        )}

        <div className="flex gap-2 mb-4">
          <Tab k="hook" label="Hooks" />
          <Tab k="script" label="Skripte" />
          <Tab k="caption" label="Captions" />
          <Tab k="hashtags" label="Hashtags" />
        </div>

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

        <div className="flex items-center gap-2">
          <button
            disabled={!canGenerate || loading || limitReached}
            onClick={() => doGenerate(false)}
            className={
              "px-4 py-2 rounded-xl border font-medium " +
              (loading || !canGenerate || limitReached
                ? "opacity-50 cursor-not-allowed"
                : "bg-black text-white dark:bg-white dark:text-black")
            }
          >
            {limitReached ? "Limit erreicht" : loading ? "Generiere…" : "Generieren"}
          </button>
          <button
            disabled={!canGenerate || loading}
            onClick={() => doGenerate(true)}
            className="px-4 py-2 rounded-xl border font-medium"
            title="Cache ignorieren (force)"
          >
            Force
          </button>
        </div>

        {/* NEU: Streaming (SSE) Box */}
        <div className="mt-6">
          <GenerateStream />
        </div>

        {/* NEU: WebSocket Generate Box */}
        <div className="mt-6">
          <GenerateWS />
        </div>

        {loading && (
          <div className="mt-4">
            <LoadingCard />
          </div>
        )}

        {error && !loading && (
          <div className="mt-4 p-3 rounded-lg border border-red-400 text-red-700 bg-red-50 dark:bg-transparent">
            Fehler: {error}
            {netHint && <pre className="mt-2 whitespace-pre-wrap text-xs opacity-80">{netHint}</pre>}
          </div>
        )}

        {!loading && variants.length === 0 && !error && (
          <div className="mt-6">
            <EmptyState title="Noch nichts generiert" hint="Wähle oben Typ & fülle das Formular aus." />
          </div>
        )}

        {!loading && variants.length > 0 && (
          <div className="mt-6 grid gap-3">
            {variants.map((v, i) => (
              <div key={i} className="p-3 rounded-xl border bg-white dark:bg-neutral-800">
                <div className="flex items-start justify-between gap-3">
                  <pre className="whitespace-pre-wrap font-sans text-sm">{v}</pre>
                  <div className="flex gap-2">
                    <CopyButton text={v} />
                    <button
                      onClick={() => saveToLibrary(v)}
                      disabled={busySaveId !== null}
                      className="shrink-0 px-3 py-1 rounded-lg border text-sm hover:opacity-80"
                    >
                      {busySaveId !== null ? "Speichere…" : "Speichern"}
                    </button>
                    <button
                      onClick={async () => {
                        if (!session) return alert("Bitte einloggen.");
                        setBusySaveId(1);
                        try {
                          const uid = session.user.id;
                          const { error } = await supabase.from("generations").insert({
                            user_id: uid,
                            type,
                            input: { topic, niche, tone },
                            output: v,
                            favorite: true,
                          });
                          if (error) throw error;
                          await loadLibrary();
                          alert("Als Favorit gespeichert ✅");
                          await supabase
                            .from("usage_log")
                            .insert({ user_id: uid, event: "save", meta: { type, favorite: true } });
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
          </div>
        )}

        {/* Library */}
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
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs opacity-70">
                  {row.type.toUpperCase()} • {new Date(row.created_at).toLocaleString()}
                </div>
                <button
                  onClick={() => toggleFavorite(row)}
                  title={row.favorite ? "Als Nicht-Favorit markieren" : "Als Favorit markieren"}
                  className={"px-2 py-1 rounded-lg border text-xs " + (row.favorite ? "bg-yellow-200 dark:bg-yellow-600" : "")}
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

/* -------------------------------------------
   Footer (immer sichtbar)
   ------------------------------------------- */
function Footer() {
  return (
    <footer className="mt-10 p-6 text-center text-xs opacity-70">
      <Link to="/privacy" className="underline mx-2">Datenschutz</Link>
      <span>·</span>
      <Link to="/imprint" className="underline mx-2">Impressum</Link>
    </footer>
  );
}

/* -------------------------------------------
   App-Wrapper mit Routing
   ------------------------------------------- */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/imprint" element={<Imprint />} />
        <Route path="*" element={<HomeApp />} />
      </Routes>
      <Footer />
      {/* NEU: Cmd+K Palette global */}
      <CmdPalette />
    </BrowserRouter>
  );
}
