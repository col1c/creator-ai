// NEU: Simple Pricing Page
import { useEffect, useState } from "react";

type Plans = {
  free: { price: number; label: string; limit: number };
  pro: { price_id?: string; label: string; euros: number };
  team: { price_id?: string; label: string; euros: number };
  enabled: boolean;
};

export default function Pricing() {
  const [plans, setPlans] = useState<Plans | null>(null);

  useEffect(() => {
    fetch(`${import.meta.env.VITE_API_BASE}/billing/plans`).then(r=>r.json()).then(setPlans);
  }, []);

  const checkout = async (price_id?: string) => {
    const r = await fetch(`${import.meta.env.VITE_API_BASE}/billing/create-checkout-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${localStorage.getItem("sb-access-token")||""}` },
      body: JSON.stringify({ price_id })
    });
    const j = await r.json();
    if (j.url) window.location.href = j.url;
    else alert(j.detail || "Checkout nicht verfügbar");
  };

  if (!plans) return <div className="p-6">Lade…</div>;

  return (
    <div className="max-w-4xl mx-auto p-6 grid gap-6 sm:grid-cols-3">
      <div className="rounded-2xl shadow p-5">
        <h3 className="text-xl font-semibold">{plans.free.label}</h3>
        <p className="text-3xl font-bold mt-2">€0</p>
        <p className="opacity-80 text-sm mt-1">{plans.free.limit} Generierungen/Monat</p>
        <button className="btn mt-4 w-full border rounded-xl py-2">Loslegen</button>
      </div>
      <div className="rounded-2xl shadow p-5 border-2">
        <h3 className="text-xl font-semibold">{plans.pro.label}</h3>
        <p className="text-3xl font-bold mt-2">€9.99</p>
        <p className="opacity-80 text-sm mt-1">Unbegrenzt + Planner-Reminders + Templates</p>
        <button className="btn mt-4 w-full border rounded-xl py-2" onClick={()=>checkout(plans.pro.price_id)} disabled={!plans.enabled}>
          Upgrade
        </button>
      </div>
      <div className="rounded-2xl shadow p-5">
        <h3 className="text-xl font-semibold">{plans.team.label}</h3>
        <p className="text-3xl font-bold mt-2">€19.99</p>
        <p className="opacity-80 text-sm mt-1">3 Seats, gemeinsame Library</p>
        <button className="btn mt-4 w-full border rounded-xl py-2" onClick={()=>checkout(plans.team.price_id)} disabled={!plans.enabled}>
          Upgrade
        </button>
      </div>
    </div>
  );
}
