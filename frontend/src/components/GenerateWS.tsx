import { useEffect, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL!,
  import.meta.env.VITE_SUPABASE_ANON_KEY!
);
const API_BASE = import.meta.env.VITE_API_BASE!;

// macht aus API_BASE die Origin (ohne /api/v1)
function wsBase(): string {
  const u = new URL(API_BASE);
  return `${u.protocol === "https:" ? "wss" : "ws"}://${u.host}`;
}

export default function GenerateWS() {
  const [type, setType] = useState<"hook"|"script"|"caption"|"hashtags">("script");
  const [topic, setTopic] = useState("");
  const [niche, setNiche] = useState("allgemein");
  const [tone, setTone] = useState("locker");
  const [out, setOut] = useState<string>("");

  const sockRef = useRef<WebSocket | null>(null);
  const [ready, setReady] = useState(false);

  const connect = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || "";
    const url = `${wsBase()}/ws/generate?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    sockRef.current = ws;
    setOut("");
    ws.onopen = () => setReady(true);
    ws.onclose = () => setReady(false);
    ws.onerror = () => setReady(false);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.status === "chunk" && msg.text) {
          setOut((prev) => prev + msg.text);
        }
      } catch {}
    };
  };

  const sendGenerate = () => {
    if (!sockRef.current || sockRef.current.readyState !== WebSocket.OPEN) return;
    sockRef.current.send(JSON.stringify({
      cmd: "generate",
      type, topic, niche, tone, engine: "auto",
    }));
  };

  useEffect(() => {
    connect();
    return () => { sockRef.current?.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="rounded-2xl border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-medium">WebSocket Generate</div>
        <button className="px-3 py-2 rounded-xl border text-sm" onClick={sendGenerate} disabled={!ready || topic.length<2}>
          Start
        </button>
      </div>
      <div className="grid gap-2 md:grid-cols-4">
        <select className="rounded-xl border px-3 py-2" value={type} onChange={(e)=>setType(e.target.value as any)}>
          <option value="hook">Hook</option>
          <option value="script">Skript</option>
          <option value="caption">Caption</option>
          <option value="hashtags">Hashtags</option>
        </select>
        <input className="rounded-xl border px-3 py-2 md:col-span-2" placeholder="Thema" value={topic} onChange={(e)=>setTopic(e.target.value)} />
        <input className="rounded-xl border px-3 py-2" placeholder="Nische" value={niche} onChange={(e)=>setNiche(e.target.value)} />
        <input className="rounded-xl border px-3 py-2" placeholder="Ton" value={tone} onChange={(e)=>setTone(e.target.value)} />
      </div>
      <div className="rounded-xl border bg-card p-3 min-h-[140px] whitespace-pre-wrap">{out || "Ausgabe…"}</div>
    </div>
  );
}
