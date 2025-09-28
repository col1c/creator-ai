// src/pages/Pricing.tsx
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

type Plans = {
  free: { price: number; label: string; limit: number };
  pro: { price_id?: string; label: string; euros: number };
  team: { price_id?: string; label: string; euros: number };
  enabled: boolean;
};

export default function Pricing() {
  const [plans, setPlans] = useState<Plans | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const API_BASE = (import.meta.env.VITE_API_BASE as string).replace(/\/+$/, "");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/billing/plans`);
        const js = await res.json();
        setPlans(js);
      } catch (e: any) {
        setErr(e?.message || "Fehler beim Laden der Pläne.");
      }
    })();
  }, [API_BASE]);

  const checkout = async (price_id?: string) => {
    setBusy(true);
    setErr(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Nicht eingeloggt.");
      const res = await fetch(`${API_BASE}/billing/create-checkout-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ price_id })
      });
      const js = await res.json();
      if (js?.url) {
        window.location.href = js.url;
      } else {
        throw new Error(js?.detail || "Checkout nicht verfügbar.");
      }
    } catch (e: any) {
      setErr(e?.message || "Checkout-Fehler.");
    } finally {
      setBusy(false);
    }
  };

  if (!plans) return <div className="p-6">Lade…</div>;

  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Preise</h1>
      {err && <div className="mb-4 p-3 rounded-xl border bg-destructive/10">{err}</div>}
      <div className="grid gap-6 sm:grid-cols-3">
        <div className="rounded-2xl shadow p-5 border">
          <h3 className="text-xl font-semibold">{plans.free.label}</h3>
          <p className="text-3xl font-bold mt-2">€0</p>
          <p className="opacity-80 text-sm mt-1">{plans.free.limit} Generierungen/Monat</p>
          <a href="/auth" className="btn mt-4 w-full border rounded-xl py-2 text-center block">Loslegen</a>
        </div>
        <div className="rounded-2xl shadow p-5 border-2">
          <h3 className="text-xl font-semibold">{plans.pro.label}</h3>
          <p className="text-3xl font-bold mt-2">€9.99</p>
          <p className="opacity-80 text-sm mt-1">Unbegrenzt + Planner-Reminders + Templates</p>
          <button
            className="btn mt-4 w-full border rounded-xl py-2"
            onClick={() => checkout(plans.pro.price_id)}
            disabled={!plans.enabled || busy}
          >
            Upgrade
          </button>
        </div>
        <div className="rounded-2xl shadow p-5 border">
          <h3 className="text-xl font-semibold">{plans.team.label}</h3>
          <p className="text-3xl font-bold mt-2">€19.99</p>
          <p className="opacity-80 text-sm mt-1">3 Seats, gemeinsame Library</p>
          <button
            className="btn mt-4 w-full border rounded-xl py-2"
            onClick={() => checkout(plans.team.price_id)}
            disabled={!plans.enabled || busy}
          >
            Upgrade
          </button>
        </div>
      </div>
    </div>
  );
}
