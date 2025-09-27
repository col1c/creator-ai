import { useEffect, useState } from "react";
import { supabase } from "./lib/supabaseClient";
import Turnstile from "./components/Turnstile";

const API = import.meta.env.VITE_API_BASE as string;

export default function Auth() {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Invite/Captcha
  const [inviteRequired, setInviteRequired] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");

  useEffect(() => {
    // prüfen, ob Invites erzwungen sind
    fetch(`${API}/beta/invite/required`)
      .then((r) => r.ok ? r.json() : { required: false })
      .then((j) => setInviteRequired(!!j.required))
      .catch(() => setInviteRequired(false));
  }, []);

  const verifyCaptcha = async () => {
    if (mode === "signup") {
      if (!captchaToken) {
        throw new Error("Bitte Captcha lösen.");
      }
      const r = await fetch(`${API}/captcha/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: captchaToken }),
      });
      if (!r.ok) throw new Error("Captcha fehlgeschlagen.");
    }
  };

  const applyInviteIfAny = async () => {
    // versucht, einen vorhandenen Invite-Code einzulösen (State oder localStorage)
    const code =
      inviteCode.trim() ||
      (localStorage.getItem("pending_invite_code") || "").trim();
    if (!code) return;

    // Access Token holen
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) {
      // später erneut versuchen (z. B. nach Login)
      localStorage.setItem("pending_invite_code", code);
      return;
    }

    const r = await fetch(`${API}/beta/invite/use`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ code }),
    });

    if (r.ok) {
      localStorage.removeItem("pending_invite_code");
      setMsg("Invite/Referral eingelöst 🎉");
    } else {
      // nicht hart failen – z. B. bereits eingelöst
      localStorage.removeItem("pending_invite_code");
    }
  };

  const submit = async () => {
    setMsg(null);
    setLoading(true);
    try {
      // Basale Checks
      if (!email || !pass) throw new Error("E-Mail & Passwort erforderlich.");

      // Captcha (nur Signup)
      await verifyCaptcha();

      if (mode === "signup") {
        // Registrieren
        const { error } = await supabase.auth.signUp({
          email,
          password: pass,
        });
        if (error) throw error;

        // Falls Session direkt vorhanden (E-Mail-Bestätigung aus): Invite sofort einlösen
        // Falls nicht: Code zwischenparken und nach Login verwenden
        if (inviteRequired && inviteCode.trim()) {
          await applyInviteIfAny();
        }

        setMsg("Registriert. Bitte E-Mail bestätigen.");
      } else {
        // Login
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password: pass,
        });
        if (error) throw error;

        // Nach Login evtl. ausstehende Invite-Codes anwenden
        await applyInviteIfAny();

        setMsg("Eingeloggt ✅");
      }
    } catch (e: any) {
      setMsg(e?.message || "Fehler");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-sm mx-auto p-6 rounded-2xl border bg-white dark:bg-neutral-800">
      <h2 className="text-lg font-semibold mb-3">
        {mode === "signin" ? "Anmelden" : "Registrieren"}
      </h2>

      <div className="space-y-3">
        <input
          className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-neutral-700"
          placeholder="E-Mail"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />

        <input
          className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-neutral-700"
          placeholder="Passwort"
          type="password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
        />

        {mode === "signup" && inviteRequired && (
          <div>
            <label className="text-sm block mb-1">Invite-Code</label>
            <input
              className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-neutral-700"
              placeholder="z. B. a1b2c3"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
            />
            <p className="text-xs opacity-70 mt-1">
              Zugang aktuell nur mit Invite. Frage ein Teammitglied nach einem
              Code.
            </p>
          </div>
        )}

        {mode === "signup" && (
          <div>
            <label className="text-sm block mb-1">Sicherheitsprüfung</label>
            <Turnstile onToken={setCaptchaToken} />
          </div>
        )}

        <button
          onClick={submit}
          disabled={loading}
          className="w-full px-4 py-2 rounded-xl border bg-black text-white dark:bg-white dark:text-black"
        >
          {loading
            ? "Bitte warten…"
            : mode === "signin"
            ? "Login"
            : "Registrieren"}
        </button>

        <button
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          className="text-sm opacity-80"
        >
          {mode === "signin"
            ? "Noch kein Account? Registrieren"
            : "Schon Account? Login"}
        </button>

        {msg && <div className="text-sm opacity-80">{msg}</div>}

        <div className="text-xs opacity-70">
          Mit der Registrierung akzeptierst du unsere{" "}
          <a href="/privacy" className="underline">
            Datenschutzbestimmungen
          </a>
          .
        </div>
      </div>
    </div>
  );
}
