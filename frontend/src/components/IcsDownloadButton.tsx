import { useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL!,
  import.meta.env.VITE_SUPABASE_ANON_KEY!
);

type Props = {
  days?: number;
  filename?: string;
  apiBase?: string; // default VITE_API_BASE
};

export default function IcsDownloadButton({
  days = 30,
  filename = "creatorai_planner.ics",
  apiBase = import.meta.env.VITE_API_BASE!,
}: Props) {
  const [loading, setLoading] = useState(false);

  const onClick = async () => {
    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const url = `${apiBase}/planner/ical?days=${days}&filename=${encodeURIComponent(filename)}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);

      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch (e) {
      console.error(e);
      alert("Download fehlgeschlagen. Bitte erneut versuchen.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={onClick}
      className="px-3 py-2 rounded-xl border text-sm hover:bg-muted disabled:opacity-50"
      disabled={loading}
      title="Kalender als .ics exportieren"
    >
      {loading ? "Export..." : "Kalender exportieren (.ics)"}
    </button>
  );
}
