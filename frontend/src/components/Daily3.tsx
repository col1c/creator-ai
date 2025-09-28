// frontend/src/components/Daily3.tsx
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

type Pack = { id?: string; idea: string; meta: { hook: string; script: string; caption: string; hashtags: string[] } };

export default function Daily3() {
  const [items, setItems] = useState<Pack[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const api = import.meta.env.VITE_API_BASE;

  useEffect(()=>{
    (async ()=>{
      setErr(null);
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      try {
        const r = await fetch(`${api}/daily3`, { headers: { Authorization: `Bearer ${token}` }});
        if (!r.ok) throw new Error(await r.text());
        const j = await r.json();
        setItems(j);
      } catch (e:any) {
        setErr(e.message || "Fehler");
      }
    })();
  }, []);

  const copyText = async (text: string)=> navigator.clipboard.writeText(text);

  if (err) return <div className="p-4 text-red-600">{err}</div>;
  if (!items) return <div className="p-4">Lade Daily-3 …</div>;

  return (
    <div className="grid md:grid-cols-3 gap-3">
      {items.map((it,idx)=>(
        <div key={idx} className="rounded-2xl border p-4 space-y-2">
          <div className="text-xs opacity-70">Hook</div>
          <div className="font-medium">{it.meta.hook}</div>
          <div className="text-xs opacity-70">Skript</div>
          <div className="text-sm">{it.meta.script}</div>
          <div className="text-xs opacity-70">Caption</div>
          <div className="text-sm">{it.meta.caption}</div>
          <div className="text-xs opacity-70">Hashtags</div>
          <div className="text-sm break-words">{it.meta.hashtags?.join(" ")}</div>
          <div className="flex gap-2 pt-2">
            <button className="px-3 py-2 rounded-xl border" onClick={()=>copyText(it.meta.hook)}>Copy Hook</button>
            <button className="px-3 py-2 rounded-xl border" onClick={()=>copyText(it.meta.script)}>Copy Skript</button>
            <button className="px-3 py-2 rounded-xl border" onClick={()=>copyText(it.meta.caption)}>Copy Caption</button>
          </div>
        </div>
      ))}
    </div>
  );
}
