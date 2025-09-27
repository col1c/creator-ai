import { useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL!,
  import.meta.env.VITE_SUPABASE_ANON_KEY!
);
const API_BASE = import.meta.env.VITE_API_BASE!;

export default function GenerateStream() {
  const [type, setType] = useState<"hook"|"script"|"caption"|"hashtags">("script");
  const [topic, setTopic] = useState("");
  const [niche, setNiche] = useState("allgemein");
  const [tone, setTone] = useState("locker");
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const start = async () => {
    if (!topic || topic.trim().length < 2) {
      alert("Bitte ein Thema (min. 2 Zeichen) eingeben.");
      return;
    }
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

        // SSE frames: split by \n\n
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
              setLines(prev => [...prev, `⚠️ ${ev.message}`]);
            }
          } catch (e) {
            // ignore bad frames
          }
        }
      }
    } catch (e) {
      console.error(e);
      setLines(prev => [...prev, "⚠️ Stream abgebrochen/fehlgeschlagen."]);
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
    const text = lines.join("\n");
    try { await navigator.clipboard.writeText(text); } catch {}
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
          <button className="px-3 py-2 rounded-xl border text-sm" onClick={copyAll} disabled={lines.length===0}>
            Copy
          </button>
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-4">
        <div className="space-y-1">
          <label className="text-xs opacity-70">Typ</label>
          <select className="w-full rounded-xl border px-3 py-2"
                  value={type}
                  onChange={(e) => setType(e.target.value as any)}>
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

      <div className="rounded-xl border bg-card p-3 min-h-[160px]">
        {lines.length === 0 && <div className="text-sm opacity-60">Ausgabe erscheint hier live…</div>}
        {lines.map((l, i) => (
          <div key={i} className="text-sm whitespace-pre-wrap leading-relaxed">
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}
