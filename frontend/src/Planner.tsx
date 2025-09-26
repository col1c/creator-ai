import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";
import { DragDropContext, Draggable, Droppable } from "@hello-pangea/dnd";
import type { DropResult } from "@hello-pangea/dnd";
import AnalyticsLight from "./components/AnalyticsLight";

/** API-Basis */
const RAW_API_BASE = import.meta.env.VITE_API_BASE as string;
const API_BASE = (RAW_API_BASE || "").replace(/\/+$/, "");
const api = (path: string) => `${API_BASE}${path}`;

type Platform = "tiktok" | "instagram" | "youtube" | "shorts" | "reels" | "other";

type Slot = {
  id: string | number;            // UUID/Int sicher
  platform: Platform;
  scheduled_at: string;           // ISO UTC
  note: string | null;
  user_id?: string;
};

const PLATFORMS: { value: Platform; label: string }[] = [
  { value: "tiktok", label: "TikTok" },
  { value: "instagram", label: "Instagram" },
  { value: "youtube", label: "YouTube" },
  { value: "shorts", label: "YouTube Shorts" },
  { value: "reels", label: "Instagram Reels" },
  { value: "other", label: "Andere" },
];

export default function Planner() {
  const [uid, setUid] = useState<string | null>(null);
  const [rows, setRows] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);

  // Add-Form
  const [platform, setPlatform] = useState<Platform>("tiktok");
  const [dtLocal, setDtLocal] = useState<string>("");
  const [note, setNote] = useState<string>("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      setUid(data.user?.id ?? null);
    })();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("planner_slots")
        .select("*")
        .order("scheduled_at", { ascending: true });
      if (error) throw error;
      setRows((data as Slot[]) || []);
    } catch (e: any) {
      alert(e?.message || "Konnte Planner nicht laden.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // ---- USAGE LOGGING
  const logEvent = async (event: string, meta: any = {}) => {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return; // silently ignore
      await fetch(api("/api/v1/usage"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ event, meta }),
      });
    } catch {
      // ignore
    }
  };

  const add = async () => {
    if (!uid) return alert("Bitte zuerst einloggen.");
    if (!dtLocal) return alert("Bitte Datum/Uhrzeit wählen.");
    try {
      const iso = new Date(dtLocal).toISOString(); // wird als UTC gespeichert
      const { error } = await supabase.from("planner_slots").insert({
        user_id: uid,
        platform,
        scheduled_at: iso,
        note: note || null,
      });
      if (error) throw error;
      await logEvent("save", { where: "planner", platform, scheduled_at: iso });
      setNote("");
      setDtLocal("");
      await load();
    } catch (e: any) {
      alert(e?.message || "Eintrag konnte nicht gespeichert werden.");
    }
  };

  const del = async (id: string | number) => {
    try {
      const row = rows.find(r => String(r.id) === String(id));
      const { error } = await supabase.from("planner_slots").delete().eq("id", id);
      if (error) throw error;
      setRows((prev) => prev.filter((r) => r.id !== id));
      await logEvent("delete", { where: "planner", id, row });
    } catch (e: any) {
      alert(e?.message || "Konnte Eintrag nicht löschen.");
    }
  };

  /** DEV-Reminder (Self) */
  const testReminder = async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        alert("Bitte einloggen.");
        return;
      }
      const res = await fetch(api("/api/v1/planner/remind/self?hours=24"), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.detail || JSON.stringify(json) || `HTTP ${res.status}`);
      alert(`Reminder ausgelöst → an: ${json.to || "?"}, Slots: ${json.count}`);
    } catch (e: any) {
      alert(e?.message || "Reminder fehlgeschlagen.");
    }
  };

  /** iCal-Export (Alias-Route) */
  const downloadIcs = async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        alert("Bitte einloggen.");
        return;
      }
      const res = await fetch(api("/api/v1/ical/planner"), {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "creatorai_planner.ics";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      await logEvent("export_ics", { where: "planner" });
    } catch (e: any) {
      alert(e?.message || "Konnte iCal nicht laden.");
    }
  };

  // === DnD-Logik ===
  const grouped = useMemo(() => {
    const g: Record<Platform, Slot[]> = {
      tiktok: [],
      instagram: [],
      youtube: [],
      shorts: [],
      reels: [],
      other: [],
    };
    for (const r of rows) g[r.platform]?.push(r);
    (Object.keys(g) as Platform[]).forEach((k) =>
      g[k].sort((a, b) =>
        new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
      )
    );
    return g;
  }, [rows]);

  const onDragEnd = async (result: DropResult) => {
    const { source, destination, draggableId } = result;
    if (!destination) return;

    const srcCol = source.droppableId as Platform;
    const dstCol = destination.droppableId as Platform;
    if (!srcCol || !dstCol) return;

    const rawId = draggableId.replace(/^slot-/, "");
    const idForQuery: string | number = /^\d+$/.test(rawId) ? Number(rawId) : rawId;
    if (!rawId) return;

    if (srcCol !== dstCol) {
      try {
        setRows((prev) =>
          prev.map((r) => (String(r.id) === rawId ? { ...r, platform: dstCol } : r))
        );
        const { error, data } = await supabase
          .from("planner_slots")
          .update({ platform: dstCol })
          .eq("id", idForQuery)
          .select("id");
        if (error) throw error;
        if (!data || !data.length) throw new Error("Update fehlgeschlagen (RLS?)");
        await logEvent("move", { from: srcCol, to: dstCol, id: rawId });
        await load();
      } catch (e: any) {
        alert(e?.message || "Konnte Plattform nicht ändern.");
        load();
      }
    }
  };

  const localDateTime = (iso: string) =>
    new Date(iso).toLocaleString([], {
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div className="max-w-6xl mx-auto p-4">
      <h1 className="text-xl font-semibold mb-4">Planner</h1>

      {/* Add-Form */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
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
          <label className="block text-xs uppercase mb-1">Datum & Zeit</label>
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

        <div className="md:col-span-2">
          <label className="block text-xs uppercase mb-1">Notiz</label>
          <input
            className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-neutral-700"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="z. B. Hook-Variante 3"
          />
        </div>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={add}
          className="px-4 py-2 rounded-xl border bg-black text-white dark:bg-white dark:text-black"
          disabled={!uid || !dtLocal}
        >
          Hinzufügen
        </button>
        <button onClick={load} className="px-3 py-2 rounded-xl border" disabled={loading}>
          {loading ? "Lade…" : "Refresh"}
        </button>
        <button onClick={downloadIcs} className="px-3 py-2 rounded-xl border">
          Export .ics
        </button>
        <button onClick={testReminder} className="px-3 py-2 rounded-xl border">
          Test-Reminder
        </button>
        <button onClick={() => setShowAnalytics(true)} className="px-3 py-2 rounded-xl border">
          Analytics
        </button>
      </div>

      {/* DnD-Board */}
      <DragDropContext onDragEnd={onDragEnd}>
        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {PLATFORMS.map((col) => {
            const items = grouped[col.value] || [];
            return (
              <div key={col.value} className="rounded-2xl border p-3">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-sm font-semibold">{col.label}</h2>
                  <span className="text-xs opacity-60">{items.length}</span>
                </div>

                <Droppable droppableId={col.value}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`min-h-[120px] rounded-xl p-2 transition ${
                        snapshot.isDraggingOver ? "bg-neutral-100 dark:bg-neutral-800" : "bg-transparent"
                      }`}
                    >
                      {items.map((r, idx) => (
                        <Draggable
                          key={`slot-${String(r.id)}`}
                          draggableId={`slot-${String(r.id)}`}
                          index={idx}
                        >
                          {(p, snap) => (
                            <div
                              ref={p.innerRef}
                              {...p.draggableProps}
                              {...p.dragHandleProps}
                              className={`mb-2 rounded-xl border p-3 bg-white dark:bg-neutral-700 ${
                                snap.isDragging ? "shadow-xl" : ""
                              }`}
                            >
                              <div className="text-sm font-medium">
                                {localDateTime(r.scheduled_at)}
                              </div>
                              {r.note && <div className="text-sm opacity-80 mt-1">{r.note}</div>}
                              <div className="mt-2 flex items-center justify-between">
                                <span className="text-xs opacity-60">ID #{String(r.id)}</span>
                                <button
                                  onClick={() => del(r.id)}
                                  className="text-xs px-2 py-1 rounded-lg border hover:bg-neutral-50 dark:hover:bg-neutral-600"
                                  title="Löschen"
                                >
                                  Löschen
                                </button>
                              </div>
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                      {!items.length && (
                        <div className="text-xs opacity-60 py-6 text-center">Ziehe Karten hierher</div>
                      )}
                    </div>
                  )}
                </Droppable>
              </div>
            );
          })}
        </div>
      </DragDropContext>

      {(!rows.length && !loading) && (
        <div className="p-3 rounded-xl border text-sm opacity-70 mt-3">Noch keine Einträge.</div>
      )}
      {loading && <div className="p-3 rounded-xl border text-sm opacity-70 mt-3">Lade Planner…</div>}

      {showAnalytics && <AnalyticsLight onClose={() => setShowAnalytics(false)} />}
    </div>
  );
}
