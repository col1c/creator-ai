// NEU: Billing Status + Success/Cancel Feedback
import { useEffect, useState } from "react";

export default function Billing() {
  const params = new URLSearchParams(location.search);
  const status = params.get("status");

  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (status === "success") setMsg("Zahlung erfolgreich. Dein Plan ist aktiviert.");
    if (status === "cancel") setMsg("Abgebrochen. Du kannst jederzeit erneut upgraden.");
  }, [status]);

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-2">Abrechnung</h1>
      {msg && <div className="rounded-xl p-3 border mb-4">{msg}</div>}
      <p>Deinen aktuellen Plan und Status findest du in den <b>Einstellungen</b>.</p>
      <a href="/pricing" className="underline mt-4 inline-block">Zu den Plänen</a>
    </div>
  );
}
