// frontend/src/components/ReferralCard.tsx
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function ReferralCard() {
  const [refCode, setRefCode] = useState<string>("—");
  const [claimCode, setClaimCode] = useState<string>("");

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      const { data, error } = await supabase
        .from("users_public")
        .select("referral_code")
        .eq("user_id", uid)
        .maybeSingle();
      if (!error && data?.referral_code) setRefCode(data.referral_code);
    })();
  }, []);

  const claim = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token || !claimCode.trim()) return alert("Bitte Code eingeben.");
    const r = await fetch(`${import.meta.env.VITE_API_BASE}/beta/invite/use`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code: claimCode.trim() })
    });
    if (r.ok) alert("Referral/Invite eingelöst 🎉");
    else alert("Ungültiger Code");
  };

  return (
    <div className="border rounded-2xl p-4">
      <h3 className="font-semibold mb-2">Referral</h3>
      <p className="text-sm opacity-80">Teile deinen Code und erhalte Bonus-Credits, sobald 3 Freunde beitreten.</p>
      <div className="mt-2">
        <div className="text-sm">Dein Code</div>
        <div className="font-mono text-lg">{refCode}</div>
      </div>
      <div className="mt-4">
        <div className="text-sm mb-1">Code einlösen</div>
        <div className="flex gap-2">
          <input className="border rounded-xl px-3 py-2 flex-1"
                 value={claimCode} onChange={e=>setClaimCode(e.target.value)} placeholder="Code eingeben" />
          <button className="border rounded-xl px-3" onClick={claim}>Einlösen</button>
        </div>
      </div>
    </div>
  );
}
