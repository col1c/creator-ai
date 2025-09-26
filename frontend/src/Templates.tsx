// NEU: src/Templates.tsx
import { useCallback, useEffect, useState } from "react";
import { supabase } from "./lib/supabaseClient";

type TType = "hook" | "script" | "caption";
type TRow = { id: number; name: string; type: TType; prompt: any; created_at: string };

const TYPES: TType[] = ["hook", "script", "caption"];

export default function Templates() {
  const [rows, setRows] = useState<TRow[]>([]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | TType>("all");
  const [loading, setLoading] = useState(false);
  const [uid, setUid] = useState<string | null>(null);

  // modal
  const [open, setOpen] = useState(false);
  const [editRow, setEditRow] = useState<TRow | null>(null);
  const [name, setName] = useState("");
  const [typ, setTyp] = useState<TType>("hook");
  const [promptRaw, setPromptRaw] = useState<string>('{"topic":"","niche":"","tone":""}');

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUid(data.user?.id ?? null));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let q = supabase.from("templates").select("id,name,type,prompt,created_at").order("created_at", { ascending: false }).limit(100);
      if (typeFilter !== "all") q = q.eq("type", typeFilter);
      const s = search.trim();
      if (s) q = q.ilike("name", `%${s}%`);
      const { data, error } = await q;
      if (error) throw error;
      setRows((data as any) || []);
    } catch (e: any) {
      alert(e?.message || "Templates konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [search, typeFilter]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditRow(null);
    setName("");
    setTyp("hook");
    setPromptRaw('{"topic":"","niche":"","tone":""}');
    setOpen(true);
  };

  const openEdit = (r: TRow) => {
    setEditRow(r);
    setName(r.name);
    setTyp(r.type);
    setPromptRaw(JSON.stringify(r.prompt ?? {}, null, 2));
    setOpen(true);
  };

  const save = async () => {
    if (!uid) return alert("Bitte einloggen.");
    let prompt: any;
    try { prompt = JSON.parse(promptRaw || "{}"); }
    catch { return alert("Prompt ist kein gültiges JSON."); }
    try {
      if (editRow) {
        const { error } = await supabase.from("templates").update({ name, type: typ, prompt }).eq("id", editRow.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("templates").insert({ user_id: uid, name, type: typ, prompt });
        if (error) throw error;
      }
      setOpen(false);
      await load();
    } catch (e: any) {
      alert(e?.message || "Speichern fehlgeschlagen.");
    }
  };

  const remove = async (r: TRow) => {
    if (!confirm(`Template „${r.name}“ löschen?`)) return;
    try {
      const { error } = await supabase.from("templates").delete().eq("id", r.id);
      if (error) throw error;
      await load();
    } catch (e: any) {
      alert(e?.message || "Löschen fehlgeschlagen.");
    }
  };

  const apply = (r: TRow) => {
    // Prefill für Generate: localStorage -> App.tsx liest es und füllt Felder
    const p = r.prompt || {};
    const prefill = {
      type: r.type,
      topic: String(p.topic || ""),
      niche: String(p.niche || ""),
      tone: String(p.tone || ""),
    };
    localStorage.setItem("creatorai_prefill", JSON.stringify(prefill));
    alert("Template angewendet. Wechsle zurück zu Generate.");
    // optional: scroll to top
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="p-4 rounded-2xl border bg-white dark:bg-neutral-800">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Templates</h2>
        <button onClick={openCreate} className="px-3 py-1.5 rounded-xl border text-sm">
          Neu
        </button>
      </div>

      <div className="grid md:grid-cols-3 gap-3 mb-3">
        <input
          className="px-3 py-2 rounded-xl border bg-white dark:bg-neutral-900"
          placeholder="Suche nach Name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="px-3 py-2 rounded-xl border bg-white dark:bg-neutral-900"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as any)}
        >
          <option value="all">Alle Typen</option>
          <option value="hook">Hooks</option>
          <option value="script">Skripte</option>
          <option value="caption">Captions</option>
        </select>
        <button onClick={load} className="px-3 py-2 rounded-xl border text-sm" disabled={loading}>
          {loading ? "Lade…" : "Neu laden"}
        </button>
      </div>

      <div className="grid gap-3">
        {rows.map((r) => (
          <div key={r.id} className="p-3 rounded-xl border bg-white dark:bg-neutral-900">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-medium">{r.name}</div>
                <div className="text-xs opacity-70">
                  {r.type.toUpperCase()} • {new Date(r.created_at).toLocaleString()}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => apply(r)} className="px-3 py-1 rounded-lg border text-sm">
                  Apply
                </button>
                <button onClick={() => openEdit(r)} className="px-3 py-1 rounded-lg border text-sm">
                  Edit
                </button>
                <button onClick={() => remove(r)} className="px-3 py-1 rounded-lg border text-sm">
                  Delete
                </button>
              </div>
            </div>

            {r.prompt && (
              <pre className="mt-2 text-xs whitespace-pre-wrap opacity-80">
                {JSON.stringify(r.prompt, null, 2)}
              </pre>
            )}
          </div>
        ))}
        {rows.length === 0 && (
          <div className="p-3 rounded-xl border text-sm opacity-70">Keine Templates vorhanden.</div>
        )}
      </div>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="w-full max-w-xl bg-white dark:bg-neutral-900 rounded-2xl border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">{editRow ? "Template bearbeiten" : "Template anlegen"}</h3>
              <button onClick={() => setOpen(false)} className="px-2 py-1 rounded-lg border text-sm">Close</button>
            </div>

            <div className="grid gap-3">
              <div>
                <label className="block text-xs uppercase mb-1">Name</label>
                <input
                  className="w-full px-3 py-2 rounded-xl border bg-white dark:bg-neutral-800"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs uppercase mb-1">Typ</label>
                <select
                  className="w-full px-3 py-2 rounded-xl border bg-white dark:bg-neutral-800"
                  value={typ}
                  onChange={(e) => setTyp(e.target.value as TType)}
                >
                  {TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs uppercase mb-1">Prompt (JSON)</label>
                <textarea
                  className="w-full h-40 px-3 py-2 rounded-xl border bg-white dark:bg-neutral-800 font-mono text-xs"
                  value={promptRaw}
                  onChange={(e) => setPromptRaw(e.target.value)}
                />
                <p className="text-xs opacity-70 mt-1">
                  Empfohlen: {"{ topic, niche, tone }"}; weitere Felder möglich.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setOpen(false)} className="px-3 py-1.5 rounded-xl border text-sm">Abbrechen</button>
              <button onClick={save} className="px-3 py-1.5 rounded-xl border bg-black text-white dark:bg-white dark:text-black text-sm">
                Speichern
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
