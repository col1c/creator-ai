import { useState } from "react";
import { supabase } from "./lib/supabaseClient";

export default function Auth() {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [mode, setMode] = useState<"signin"|"signup">("signin");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setMsg(null); setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password: pass });
        if (error) throw error;
        setMsg("Check deine E-Mails für die Bestätigung.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
        if (error) throw error;
        setMsg("Eingeloggt ✅");
      }
    } catch (e: any) {
      setMsg(e.message || "Fehler");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-sm mx-auto p-6 rounded-2xl border bg-white dark:bg-neutral-800">
      <h2 className="text-lg font-semibold mb-3">Anmelden</h2>
      <div className="space-y-2">
        <input className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-neutral-700"
               placeholder="E-Mail" value={email} onChange={e=>setEmail(e.target.value)} />
        <input className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-neutral-700"
               placeholder="Passwort" type="password" value={pass} onChange={e=>setPass(e.target.value)} />
        <button onClick={submit} disabled={loading}
                className="w-full px-4 py-2 rounded-xl border bg-black text-white dark:bg-white dark:text-black">
          {loading ? "Bitte warten…" : (mode==="signin" ? "Login" : "Registrieren")}
        </button>
        <button onClick={()=>setMode(mode==="signin"?"signup":"signin")} className="text-sm opacity-80">
          {mode==="signin" ? "Noch kein Account? Registrieren" : "Schon Account? Login"}
        </button>
        {msg && <div className="text-sm opacity-80">{msg}</div>}
      </div>
    </div>
  );
}
