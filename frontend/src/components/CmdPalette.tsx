import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

type Cmd = { id: string; title: string; hint?: string; run: () => void };

export default function CmdPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const cmds: Cmd[] = useMemo(() => [
    { id: "new-idea", title: "Neue Idee (Generate)", run: () => navigate("/generate") },
    { id: "daily-3", title: "Daily-3 öffnen", run: () => navigate("/dashboard") },
    { id: "planner", title: "Planner öffnen", run: () => navigate("/planner") },
    { id: "templates", title: "Templates öffnen", run: () => navigate("/templates") },
    { id: "library", title: "Library öffnen", run: () => navigate("/library") },
    { id: "settings", title: "Einstellungen", run: () => navigate("/settings") },
    { id: "export", title: "Daten exportieren", run: () => navigate("/settings") },
    { id: "privacy", title: "Datenschutz", run: () => navigate("/privacy") },
    { id: "imprint", title: "Impressum", run: () => navigate("/imprint") },
  ], [navigate]);

  const visible = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return cmds.slice(0, 7);
    return cmds.filter(c => c.title.toLowerCase().includes(qq));
  }, [q, cmds]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setQ("");
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
      <div className="absolute left-1/2 top-24 -translate-x-1/2 w-[92vw] max-w-xl rounded-2xl border bg-background shadow-xl">
        <div className="p-3 border-b">
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full outline-none bg-transparent text-sm"
            placeholder="Tippe einen Befehl… (Cmd/Ctrl + K)"
          />
        </div>
        <div className="p-2 max-h-80 overflow-auto">
          {visible.length === 0 && (
            <div className="p-3 text-sm opacity-60">Keine Treffer.</div>
          )}
          {visible.map((c) => (
            <button
              key={c.id}
              onClick={() => { c.run(); setOpen(false); }}
              className="w-full text-left px-3 py-2 rounded-xl hover:bg-muted text-sm"
            >
              {c.title}
            </button>
          ))}
        </div>
        <div className="px-3 py-2 text-[11px] opacity-60 border-t">
          ⌘/Ctrl + K · Enter: Ausführen · Esc: Schließen
        </div>
      </div>
    </div>
  );
}
