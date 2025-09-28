// frontend/src/components/ReportAbuseModal.tsx
import { useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function ReportAbuseModal({ onClose }: { onClose: ()=>void }) {
  const [type, setType] = useState("abuse");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const api = import.meta.env.VITE_API_BASE;

  const submit = async () => {
    setLoading(true);
    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;
    await fetch(`${api}/report`, {
      method: "POST",
      headers: {
        "Content-Type":"application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ type, message, context: { path: location.pathname } })
    });
    setLoading(false);
    onClose();
    alert("Danke fürs Melden. Wir kümmern uns.");
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-neutral-900 rounded-2xl p-4 w-full max-w-md space-y-3">
        <div className="text-lg font-semibold">Missbrauch melden</div>
        <div className="space-y-2">
          <select value={type} onChange={e=>setType(e.target.value)} className="w-full border rounded-lg p-2">
            <option value="abuse">Missbrauch/Spam</option>
            <option value="bug">Bug</option>
            <option value="legal">Rechtlich</option>
            <option value="other">Sonstiges</option>
          </select>
          <textarea
            rows={4}
            className="w-full border rounded-lg p-2"
            placeholder="Beschreibe kurz, was passiert ist…"
            value={message}
            onChange={e=>setMessage(e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-xl border">Abbrechen</button>
          <button onClick={submit} disabled={loading} className="px-3 py-2 rounded-xl border bg-black text-white dark:bg-white dark:text-black">
            {loading ? "Sende…" : "Senden"}
          </button>
        </div>
      </div>
    </div>
  );
}
