import { useEffect, useState } from "react";
import { supabase } from "./lib/supabaseClient";

type Slot = {
  id: number;
  platform: "tiktok" | "instagram" | "youtube";
  scheduled_at: string; // ISO
  note: string | null;
};

export default function Planner() {
  const [rows, setRows] = useState<Slot[]>([]);
  const [platform, setPlatform] = useState<Slot["platform"]>("tiktok");
  const [dtLocal, setDtLocal] = useState<string>(""); // yyyy-MM-ddTHH:mm
  const [note, setNote] = useState("");

  const load = async () => {
    const { data, error } = await supabase
      .from("planner_slots")
      .select("id,platform,scheduled_at,note")
      .order("scheduled_at", { ascending: true })
      .limit(100);
    if (!error && data) setRows(data as any);
  };

  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!dtLocal) return alert("Bitte Datum/Uhrzeit wählen");
    const iso = new Date(dtLocal).toISOString(); // speichert UTC
    const { error } = await supabase.from("planner_slots").insert({
      platform, scheduled_at: iso, note: note || null
    });
    if (error) return alert(error.message);
    setNote("");
    setDtLocal("");
    await load();
  };

  const del = async (id: number) => {
    const { error } = await supabase.from("planner_slots").delete().eq("id", id);
    if (error) return alert(error.message);
    await load();
  };

  return (
    <div className="p-4 rounded-2xl border bg-white dark:bg-neutral-800">
      <h2 className="text-lg font-semibold mb-3">Planner</h2>

      <div className="grid md:grid-cols-3 gap-3 mb-3">
        <div>
          <label className="block text-xs uppercase mb-1">Plattform</label>
          <select className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-neutral-700"
                  value={platform} onChange={e=>setPlatform(e.target.value as any)}>
            <option value="tiktok">TikTok</option>
            <option value="instagram">Instagram</option>
            <option value="youtube">YouTube Shorts</option>
          </select>
        </div>
        <div>
          <label className="block text-xs uppercase mb-1">Datum & Zeit</label>
          <input type="datetime-local"
                 className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-neutral-700"
                 value={dtLocal} onChange={e=>setDtLocal(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs uppercase mb-1">Notiz</label>
          <input className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-neutral-700"
                 value={note} onChange={e=>setNote(e.target.value)} placeholder="z. B. Hook-Variante 3" />
        </div>
      </div>

      <button onClick={add} className="mb-4 px-4 py-2 rounded-xl border bg-black text-white dark:bg-white dark:text-black">
        Hinzufügen
      </button>

      <div className="grid gap-3">
        {rows.map(r => (
          <div key={r.id} className="p-3 rounded-xl border bg-white dark:bg-neutral-900">
            <div className="text-sm font-medium">{r.platform.toUpperCase()}</div>
            <div className="text-sm opacity-80">
              {new Date(r.scheduled_at).toLocaleString()} {/* lokales TZ-Format */}
            </div>
            {r.note && <div className="text-sm mt-1">{r.note}</div>}
            <div className="mt-2">
              <button onClick={()=>del(r.id)} className="px-3 py-1 rounded-lg border text-sm">Löschen</button>
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <div className="p-3 rounded-xl border text-sm opacity-70">Noch keine Einträge.</div>
        )}
      </div>
    </div>
  );
}
