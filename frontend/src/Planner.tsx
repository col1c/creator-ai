import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";
import { DragDropContext, Draggable, Droppable } from "@hello-pangea/dnd";
import type { DropResult } from "@hello-pangea/dnd";

type Platform = "tiktok" | "instagram" | "youtube" | "shorts" | "reels" | "other";

type Slot = {
  id: string | number;            // ← String ODER Number (UUID-safe)
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
      setNote("");
      setDtLocal("");
      await load();
    } catch (e: any) {
      alert(e?.message || "Eintrag konnte nicht gespeichert werden.");
    }
  };

  const del = async (id: string | number) => {
    try {
      const { error } = await supabase.from("planner_slots").delete().eq("id", id);
      if (error) throw error;
      setRows((prev) => prev.filter((r) => r.id !== id));
    } catch (e: any) {
      alert(e?.message || "Konnte Eintrag nicht löschen.");
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
    // pro Spalte nach Zeit sortieren
    (Object.keys(g) as Platform[]).forEach((k) =>
      g[k].sort(
        (a, b) =>
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

    // ID NICHT in Number casten (UUID-safe)
    const rawId = draggableId.replace(/^slot-/, "");
    const id: string | number = rawId;
    if (!rawId) return;

    if (srcCol !== dstCol) {
      try {
        // Optimistisch im UI updaten
        setRows((prev) => prev.map((r) => (String(r.id) === rawId ? { ...r, platform: dstCol } : r)));

        // Persistieren
        const { error } = await supabase
          .from("planner_slots")
          .update({ platform: dstCol })
          .eq("id", id);

        if (error) throw error;

        // Server-Truth nachziehen (für volle Sicherheit)
        await load();
      } catch (e: any) {
        alert(e?.message || "Konnte Plattform nicht ändern.");
        // Fallback: reload auf Server-Stand
        load();
      }
    } else {
      // Reorder innerhalb der Spalte: aktuell nur visuell (kein position-Feld)
    }
  };

  // Utils
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
        <button
          onClick={load}
          className="px-3 py-2 rounded-xl border"
          disabled={loading}
        >
          {loading ? "Lade…" : "Refresh"}
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
                        snapshot.isDraggingOver
                          ? "bg-neutral-100 dark:bg-neutral-800"
                          : "bg-transparent"
                      }`}
                    >
                      {items.map((r, idx) => (
                        <Draggable
                          key={`slot-${String(r.id)}`}           // ← ID als String
                          draggableId={`slot-${String(r.id)}`}    // ← ID als String
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
                              {r.note && (
                                <div className="text-sm opacity-80 mt-1">
                                  {r.note}
                                </div>
                              )}
                              <div className="mt-2 flex items-center justify-between">
                                <span className="text-xs opacity-60">
                                  ID #{String(r.id)}
                                </span>
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
                        <div className="text-xs opacity-60 py-6 text-center">
                          Ziehe Karten hierher
                        </div>
                      )}
                    </div>
                  )}
                </Droppable>
              </div>
            );
          })}
        </div>
      </DragDropContext>

      {!rows.length && !loading && (
        <div className="p-3 rounded-xl border text-sm opacity-70 mt-3">
          Noch keine Einträge.
        </div>
      )}
      {loading && (
        <div className="p-3 rounded-xl border text-sm opacity-70 mt-3">
          Lade Planner…
        </div>
      )}
    </div>
  );
}
