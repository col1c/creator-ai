// NEU: Referral Anzeige + Claim
import { useEffect, useState } from "react";

export default function ReferralCard() {
  const [refCode, setRefCode] = useState<string>("");
  const [claimCode, setClaimCode] = useState<string>("");

  useEffect(() => {
    // minimal: aus /me Profil laden (falls du dafür einen Endpoint hast)
    // fallback: aus localStorage/Settings ziehen – hier Dummy:
    const code = localStorage.getItem("referral_code") || "";
    setRefCode(code);
  }, []);

  const claim = async () => {
    const r = await fetch(`${import.meta.env.VITE_API_BASE}/beta/invite/use`, {
      method: "POST",
      headers: { "Content-Type":"application/json", "Authorization": `Bearer ${localStorage.getItem("sb-access-token")||""}` },
      body: JSON.stringify({ code: claimCode })
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
        <div className="font-mono text-lg">{refCode || "—"}</div>
      </div>
      <div className="mt-4">
        <div className="text-sm mb-1">Code einlösen</div>
        <div className="flex gap-2">
          <input className="border rounded-xl px-3 py-2 flex-1" placeholder="CODE123" value={claimCode} onChange={e=>setClaimCode(e.target.value)} />
          <button className="border rounded-xl px-3" onClick={claim}>Einlösen</button>
        </div>
      </div>
    </div>
  );
}
