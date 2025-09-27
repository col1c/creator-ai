import { useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL!,
  import.meta.env.VITE_SUPABASE_ANON_KEY!
);
const API_BASE = import.meta.env.VITE_API_BASE!;

export default function ExportDeletePanel() {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState("");

  const exportZip = async () => {
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const res = await fetch(`${API_BASE}/export`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Export failed: ${res.status}`);
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = "creatorai_export.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch (e) {
      console.error(e);
      alert("Export fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

  const deleteAccount = async (alsoAuth: boolean) => {
    if (confirm !== "DELETE") {
      alert('Bitte tippe "DELETE" in das Bestätigungsfeld.');
      return;
    }
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const res = await fetch(`${API_BASE}/delete_account`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ delete_auth: alsoAuth }),
      });
      const js = await res.json();
      if (!res.ok || !js.ok) throw new Error("Delete failed");

      if (alsoAuth) {
        // User ist gelöscht – lokal ausloggen
        await supabase.auth.signOut();
        window.location.href = "/auth";
      } else {
        alert("Daten gelöscht. Dein Account (Login) besteht weiterhin.");
      }
    } catch (e) {
      console.error(e);
      alert("Löschen fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border p-4 space-y-3">
      <div className="font-medium">Daten-Export & Löschung</div>
      <div className="flex gap-2">
        <button className="px-3 py-2 rounded-xl border text-sm disabled:opacity-50"
                onClick={exportZip} disabled={busy}>
          Export als ZIP
        </button>
      </div>
      <div className="pt-2 space-y-2">
        <div className="text-sm opacity-80">
          Account-Daten löschen? Dies entfernt Inhalte (Generations, Templates, Planner, Protokolle).
          Optional kann auch dein Login (Auth-Account) gelöscht werden.
        </div>
        <input
          className="w-full rounded-xl border px-3 py-2 text-sm"
          placeholder='Tippe zur Bestätigung: "DELETE"'
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <button
            className="px-3 py-2 rounded-xl border text-sm disabled:opacity-50"
            onClick={() => deleteAccount(false)}
            disabled={busy}
          >
            Daten löschen (Account behalten)
          </button>
          <button
            className="px-3 py-2 rounded-xl border text-sm bg-destructive/10 hover:bg-destructive/20 disabled:opacity-50"
            onClick={() => deleteAccount(true)}
            disabled={busy}
            title="Entfernt auch dein Login (Auth-Account)"
          >
            Daten + Auth-Account löschen
          </button>
        </div>
      </div>
    </div>
  );
}
