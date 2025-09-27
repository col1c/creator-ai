import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL!,
  import.meta.env.VITE_SUPABASE_ANON_KEY!
);
const API_BASE = import.meta.env.VITE_API_BASE!;

type TType = "hook"|"script"|"caption"|"hashtags";

export default function GenerateStream() {
  const [type, setType] = useState<TType>("script");
  const [topic, setTopic] = useState("");
  const [niche, setNiche] = useState("allgemein");
  const [tone, setTone] = useState("locker");

  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Planner quick-add
  const [platform, setPlatform] = useState<"tiktok"|"instagram"|"youtube">("tiktok");
  const [whenLocal, setWhenLocal] = useState<string>(""); // datetime-local string

  useEffect(() => {
    // default: morgen 09:00 local
    const d = new Date();
    d.setDate(d.getDate()+1);
    d.setHours(9,0,0,0);
    setWhenLocal(new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,16));
  }, []);

  const fullText = useMemo(() => lines.join(""), [lines]);

  const start = async () => {
    if (!topic || topic.trim().length < 2) {
      alert("Bitte ein Thema (min. 2 Zeichen) eingeben.");
      return;
    }
    setErr(null);
    setLines([]);
    setRunning(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const res = await fetch(`${API_BASE}/generate_stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "text/event-stream",
          ...(token ? { "Authorization": `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ type, topic, niche, tone, engine: "auto" }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error(`Stream failed: ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const frame = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 2);
          if (!frame.startsWith("data:")) continue;
          const jsonStr = frame.replace(/^data:\s*/, "");
          try {
            const ev = JSON.parse(jsonStr);
            if (ev.status === "chunk" && ev.text) {
              setLines(prev => [...prev, ev.text as string]);
            } else if (ev.status === "error") {
              setErr(ev.message || "Fehler");
            }
          } catch {}
        }
      }
    } catch (e: any) {
      console.error(e);
      setErr("Stream abgebrochen/fehlgeschlagen.");
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    setRunning(false);
  };

  const copyAll = async () => {
    try { await navigator.clipboard.writeText(fullText); } catch {}
  };

  const addToPlanner = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error("Not authenticated");

      if (!whenLocal) { alert("Bitte Datum/Uhrzeit wählen"); return; }

      // datetime-local -> UTC ISO
      const dt = new Date(whenLocal);
      const utcIso = new Date(dt.getTime() + dt.getTimezoneOffset()*60000).toISOString();

      // Note = kurze Vorschau aus Output
      const note = (fullText || topic).slice(0, 180);

      const { error } = await supabase
        .from("planner_slots")
        .insert({
          user_id: user.id,          // RLS with check
          platform,
          scheduled_at: utcIso,
          note,
          generation_id: null,
        });

      if (error) throw error;
      alert("Zum Planner hinzugefügt.");
    } catch (e) {
      console.error(e);
      alert("Konnte Planner-Slot nicht anlegen.");
    }
  };

  return (
    <div className="rounded-2xl border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-medium">Streaming (Beta)</div>
        <div className="flex gap-2">
          {!running ? (
            <button className="px-3 py-2 rounded-xl border text-sm" onClick={start}>
              Start
            </button>
          ) : (
            <button className="px-3 py-2 rounded-xl border text-sm" onClick={stop}>
              Stop
            </button>
          )}
          <button className="px-3 py-2 rounded-xl border text-sm" onClick={copyAll} disabled={!fullText}>
            Copy
          </button>
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-4">
        <div className="space-y-1">
          <label className="text-xs opacity-70">Typ</label>
          <select className="w-full rounded-xl border px-3 py-2" value={type} onChange={(e)=>setType(e.target.value as TType)}>
            <option value="hook">Hook</option>
            <option value="script">Skript</option>
            <option value="caption">Caption</option>
            <option value="hashtags">Hashtags</option>
          </select>
        </div>
        <div className="space-y-1 md:col-span-2">
          <label className="text-xs opacity-70">Thema</label>
          <input className="w-full rounded-xl border px-3 py-2" value={topic} onChange={(e)=>setTopic(e.target.value)} placeholder="z.B. 3 Fehler beim Bankdrücken" />
        </div>
        <div className="space-y-1">
          <label className="text-xs opacity-70">Nische</label>
          <input className="w-full rounded-xl border px-3 py-2" value={niche} onChange={(e)=>setNiche(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-xs opacity-70">Ton</label>
          <input className="w-full rounded-xl border px-3 py-2" value={tone} onChange={(e)=>setTone(e.target.value)} />
        </div>
      </div>

      {/* Output-Box mit Spinner */}
      <div className="rounded-xl border bg-card p-3 min-h-[160px] relative">
        {running && (
          <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
            <div className="animate-spin w-6 h-6 border-2 rounded-full border-neutral-500 border-t-transparent" />
          </div>
        )}
        {!fullText && !running && <div className="text-sm opacity-60">Ausgabe erscheint hier live…</div>}
        <div className="space-y-1">
          {lines.map((l, i) => (
            <div key={i} className="text-sm whitespace-pre-wrap leading-relaxed">
              {l}
            </div>
          ))}
        </div>
        {err && <div className="mt-2 text-xs text-red-600">⚠️ {err}</div>}
      </div>

      {/* Quick Add to Planner */}
      <div className="rounded-xl border p-3">
        <div className="text-sm font-medium mb-2">In Planner übernehmen</div>
        <div className="grid gap-2 md:grid-cols-3">
          <div className="space-y-1">
            <label className="text-xs opacity-70">Plattform</label>
            <select className="w-full rounded-xl border px-3 py-2" value={platform} onChange={(e)=>setPlatform(e.target.value as any)}>
              <option value="tiktok">TikTok</option>
              <option value="instagram">Instagram</option>
              <option value="youtube">YouTube</option>
            </select>
          </div>
          <div className="space-y-1 md:col-span-2">
            <label className="text-xs opacity-70">Zeitpunkt</label>
            <input type="datetime-local" className="w-full rounded-xl border px-3 py-2"
                   value={whenLocal} onChange={(e)=>setWhenLocal(e.target.value)} />
          </div>
        </div>
        <div className="mt-2">
          <button className="px-3 py-2 rounded-xl border text-sm" onClick={addToPlanner} disabled={!fullText && !topic}>
            Zum Planner hinzufügen
          </button>
        </div>
      </div>
    </div>
  );
}
