import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

type Stats = {
  range: { from: string; to: string; days: number };
  totals_by_event: Record<string, number>;
  daily: Record<string, number>;
  total: number;
};

export default function AnalyticsLight({ onClose }: { onClose: () => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const apiBase = (import.meta.env.VITE_API_BASE as string || "").replace(/\/+$/, "");

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) throw new Error("Nicht eingeloggt.");

        const res = await fetch(`${apiBase}/api/v1/stats?days=30`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.detail || "Konnte Stats nicht laden.");
        setStats(json as Stats);
      } catch (e: any) {
        setErr(e?.message || "Fehler beim Laden.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-neutral-800 border p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Analytics (30 Tage)</h2>
          <button className="text-sm px-2 py-1 rounded-lg border" onClick={onClose}>Schließen</button>
        </div>

        {loading && <div className="text-sm opacity-70">Lade…</div>}
        {err && <div className="text-sm text-red-600">{err}</div>}

        {stats && (
          <div className="space-y-3">
            <div className="text-xs opacity-70">
              Zeitraum: {new Date(stats.range.from).toLocaleDateString()} – {new Date(stats.range.to).toLocaleDateString()}
            </div>
            <div className="rounded-xl border p-3">
              <div className="text-sm font-medium mb-2">Totals by Event</div>
              {Object.keys(stats.totals_by_event).length === 0 ? (
                <div className="text-sm opacity-70">Keine Events.</div>
              ) : (
                <ul className="text-sm space-y-1">
                  {Object.entries(stats.totals_by_event).map(([k, v]) => (
                    <li key={k} className="flex items-center justify-between">
                      <span>{k}</span>
                      <span className="font-semibold">{v}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-xl border p-3">
              <div className="text-sm font-medium mb-2">Total</div>
              <div className="text-xl font-semibold">{stats.total}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
