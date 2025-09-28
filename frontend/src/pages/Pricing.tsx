// src/pages/Pricing.tsx
// NEU (bereinigt): Simple Pricing Page mit Supabase-Session & Stripe-Portal
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

type Plans = {
  free: { price: number; label: string; limit: number };
  pro: { price_id?: string; label: string; euros: number } | null;
  team?: { price_id?: string; label: string; euros: number } | null;
  enabled: boolean;
};

export default function Pricing() {
  const [plans, setPlans] = useState<Plans | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const api = import.meta.env.VITE_API_BASE;

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const r = await fetch(`${api}/billing/plans`);
        if (!r.ok) throw new Error(await r.text());
        const j = await r.json();
        setPlans(j);
      } catch (e: any) {
        setError(e?.message || "Konnte Pricing nicht laden.");
      } finally {
        setLoading(false);
      }
    })();
  }, [api]);

  const getToken = async (): Promise<string | null> => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  };

  const requireAuth = async (): Promise<string> => {
    const token = await getToken();
    if (!token) {
      alert("Bitte zuerst einloggen.");
      // optional: Return to pricing after login
      window.location.href = "/auth";
      throw new Error("not-authenticated");
    }
    return token;
  };

  const checkout = async (price_id?: string) => {
    try {
      setBusy(true);
      const token = await requireAuth();
      const r = await fetch(`${api}/billing/create-checkout-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ price_id })
      });
      const j = await r.json();
      if (j.url) window.location.href = j.url;
      else alert(j.detail || "Checkout nicht verfügbar.");
    } catch (e: any) {
      if (e?.message !== "not-authenticated") {
        alert(e?.message || "Fehler beim Checkout.");
      }
    } finally {
      setBusy(false);
    }
  };

  const openPortal = async () => {
    try {
      setBusy(true);
      const token = await requireAuth();
      const r = await fetch(`${api}/billing/portal`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      const j = await r.json();
      if (j.url) window.location.href = j.url;
      else alert(j.detail || "Portal nicht verfügbar.");
    } catch (e: any) {
      if (e?.message !== "not-authenticated") {
        alert(e?.message || "Fehler beim Öffnen des Portals.");
      }
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="p-6">Lade Preise…</div>;
  if (error || !plans) return <div className="p-6 text-red-600">{error || "Unbekannter Fehler."}</div>;

  const pro = plans.pro;
  const team = plans.team ?? null;

  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-6">Preise</h1>

      <div className="grid gap-6 sm:grid-cols-3">
        {/* Free */}
        <div className="rounded-2xl border p-5">
          <h3 className="text-xl font-semibold">{plans.free.label}</h3>
          <p className="text-3xl font-bold mt-2">€{(plans.free.price ?? 0).toFixed(0)}</p>
          <p className="opacity-80 text-sm mt-1">
            {plans.free.limit} Generierungen/Monat
          </p>
          <button
            className="mt-4 w-full rounded-xl border py-2"
            onClick={() => (window.location.href = "/auth")}
          >
            Loslegen
          </button>
        </div>

        {/* Pro */}
        <div className="rounded-2xl border-2 p-5">
          <h3 className="text-xl font-semibold">{pro?.label ?? "Pro"}</h3>
          <p className="text-3xl font-bold mt-2">€{(pro?.euros ?? 9.99).toFixed(2)}</p>
          <p className="opacity-80 text-sm mt-1">
            Unbegrenzt + Planner-Reminders + Templates
          </p>
          <div className="flex gap-2 mt-4">
            <button
              className="flex-1 rounded-xl border py-2"
              onClick={() => checkout(pro?.price_id)}
              disabled={!plans.enabled || busy}
              title={!plans.enabled ? "Zahlung aktuell deaktiviert" : ""}
            >
              Upgrade
            </button>
            <button
              className="rounded-xl border py-2 px-3"
              onClick={openPortal}
              disabled={busy}
              title="Abo verwalten (Stripe-Portal)"
            >
              Abo verwalten
            </button>
          </div>
        </div>

        {/* Team (optional) */}
        <div className="rounded-2xl border p-5 opacity-100">
          <h3 className="text-xl font-semibold">{team?.label ?? "Team"}</h3>
          <p className="text-3xl font-bold mt-2">€{(team?.euros ?? 19.99).toFixed(2)}</p>
          <p className="opacity-80 text-sm mt-1">3 Seats, gemeinsame Library</p>
          <button
            className="mt-4 w-full rounded-xl border py-2"
            onClick={() => checkout(team?.price_id)}
            disabled={!plans.enabled || busy || !team?.price_id}
            title={!team?.price_id ? "Bald verfügbar" : (!plans.enabled ? "Zahlung aktuell deaktiviert" : "")}
          >
            {team?.price_id ? "Upgrade" : "Bald verfügbar"}
          </button>
        </div>
      </div>
    </div>
  );
}
