// frontend/src/pages/Analytics.tsx
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

type StatRes = {
  window_days: number;
  generated_at: string;
  totals: {
    users_total: number;
    generations_30d: number;
    saves_30d: number;
    planner_add_30d: number;
    active_users_7d: number;
    active_users_28d: number;
    activation_users_30d: number;
  };
  top: {
    topics_30d: { name: string; count: number }[];
    niches_from_generations_30d: { name: string; count: number }[];
    niches_from_users_30d: { name: string; count: number }[];
  };
};

export default function Analytics() {
  const [data, setData] = useState<StatRes | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const api = import.meta.env.VITE_API_BASE;

  useEffect(() => {
    (async () => {
      setErr(null);
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      try {
        const r = await fetch(`${api}/stats`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) throw new Error(await r.text());
        const j = await r.json();
        setData(j);
      } catch (e: any) {
        setErr(e.message || "Fehler beim Laden");
      }
    })();
  }, []);

  const Card = (p: { label: string; value: number | string }) => (
    <div className="rounded-2xl border p-4">
      <div className="text-sm opacity-70">{p.label}</div>
      <div className="text-2xl font-semibold">{p.value}</div>
    </div>
  );

  const List = (p: { title: string; items: {name:string;count:number}[] }) => (
    <div className="rounded-2xl border p-4">
      <div className="font-medium mb-2">{p.title}</div>
      <ul className="space-y-1">
        {p.items?.map((it,i)=>(
          <li key={i} className="flex justify-between">
            <span className="truncate">{it.name}</span>
            <span className="tabular-nums">{it.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );

  if (err) return <div className="p-6 text-red-600">{err}</div>;
  if (!data) return <div className="p-6">Lade Analytics…</div>;

  const t = data.totals;
  const top = data.top;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Analytics (letzte {data.window_days} Tage)</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card label="Nutzer gesamt" value={t.users_total} />
        <Card label="Generierungen" value={t.generations_30d} />
        <Card label="Saves" value={t.saves_30d} />
        <Card label="Planner Adds" value={t.planner_add_30d} />
        <Card label="Active 7d" value={t.active_users_7d} />
        <Card label="Active 28d" value={t.active_users_28d} />
        <Card label="Aktivierungen 30d" value={t.activation_users_30d} />
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <List title="Top Topics" items={top.topics_30d} />
        <List title="Top Nischen (Generations)" items={top.niches_from_generations_30d} />
        <List title="Top Nischen (Aktive Nutzer)" items={top.niches_from_users_30d} />
      </div>

      <div className="text-xs opacity-70">Stand: {new Date(data.generated_at).toLocaleString()}</div>
    </div>
  );
}
