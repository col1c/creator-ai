import { useEffect, useState } from "react";
import { supabase } from "./lib/supabaseClient";

type Platform = "tiktok" | "instagram" | "youtube" | "shorts" | "reels" | "other";

type Slot = {
  id: number;
  platform: Platform;
  scheduled_at: string; // ISO (UTC)
  note: string | null;
};

const PLATFORMS: { value: Platform; label: string }[] = [
  { value: "tiktok", label: "TikTok" },
  { value: "instagram", label: "Instagram" },
  { value: "youtube", label: "YouTube" },
  { value: "shorts", label: "YouTube Shorts" },
  { value: "reels", label: "Instagram Reels" },
  { value: "other", label: "Other" },
];

export default function Planner() {
  const [rows, setRows] = useState<Slot[]>([]);
  const [platform, setPlatform] = useState<Platform>("tiktok");
  const [dtLocal, setDtLocal] = useState<string>(""); // yyyy-MM-ddTHH:mm (local)
  const [note, setNote] = useState("");
  const [uid, setUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // get current user id for RLS inserts
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUid(data.user?.id ?? null));
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("planner_slots")
        .select("id,platform,scheduled_at,note")
        .order("scheduled_at", { ascending: true })
        .limit(100);
      if (error) throw error;
      setRows((data as any) || []);
    } catch (e: any) {
      alert(e?.message || "Planner konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const add = async () => {
    if (!uid) return alert("Bitte einloggen.");
    if (!dtLocal) return alert("Bitte Datum/Uhrzeit wählen.");
    const iso = new Date(dtLocal).toISOString(); // speichert UTC
    try {
      const { error } = await supabase.from("planner_slots").insert({
        user_id: uid, // wichtig für RLS: auth.uid() = user_id
        platform,
        scheduled_at: iso,
        note: note || null,
      });
      if (error) throw error;
      setNote("");
      setDtLocal("");
      await load();
    } catch (e: any) {
      alert(e?.message || "Eintrag konnte nicht gespeichert werden.");
    }
  };

  const del = async (id: number) => {
    try {
      const { error } = await supabase.from("planner_slots").delete().eq("id", id);
      if (error) throw error;
      await load();
    } catch (e: any) {
      alert(e?.message || "Löschen fehlgeschlagen.");
    }
  };

  return (
    <div className="p-4 rounded-2xl border bg-white dark:bg-neutral-800">
      <h2 className="text-lg font-semibold mb-3">Planner</h2>

      <div className="grid md:grid-cols-3 gap-3 mb-3">
        <div>
          <label className="block text-xs uppercase mb-1">Plattform</label>
          <select
            className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-neutral-700"
            value={platform}
            onChange={(e) => setPlatform(e.target.value as Platform)}
          >
            {PLATFORMS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs uppercase mb-1">Datum &amp; Zeit</label>
          <input
            type="datetime-local"
            className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-neutral-700"
            value={dtLocal}
            onChange={(e) => setDtLocal(e.target.value)}
          />
          <p className="mt-1 text-xs opacity-70">
            Speichert in UTC. Anzeige unten in deiner lokalen Zeitzone.
          </p>
        </div>

        <div>
          <label className="block text-xs uppercase mb-1">Notiz</label>
          <input
            className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-neutral-700"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="z. B. Hook-Variante 3"
          />
        </div>
      </div>

      <button
        onClick={add}
        className="mb-4 px-4 py-2 rounded-xl border bg-black text-white dark:bg-white dark:text-black"
        disabled={!uid || !dtLocal}
      >
        Hinzufügen
      </button>

      <div className="grid gap-3">
        {rows.map((r) => (
          <div key={r.id} className="p-3 rounded-xl border bg-white dark:bg-neutral-900">
            <div className="text-sm font-medium">{r.platform.toUpperCase()}</div>
            <div className="text-sm opacity-80">
              {new Date(r.scheduled_at).toLocaleString()} {/* lokales TZ-Format */}
            </div>
            {r.note && <div className="text-sm mt-1">{r.note}</div>}
            <div className="mt-2">
              <button onClick={() => del(r.id)} className="px-3 py-1 rounded-lg border text-sm">
                Löschen
              </button>
            </div>
          </div>
        ))}
        {rows.length === 0 && !loading && (
          <div className="p-3 rounded-xl border text-sm opacity-70">Noch keine Einträge.</div>
        )}
        {loading && (
          <div className="p-3 rounded-xl border text-sm opacity-70">Lade Planner…</div>
        )}
      </div>
    </div>
  );
}
