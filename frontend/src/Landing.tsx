export default function Landing({ onSignup }: { onSignup: () => void }) {
  const Feature = ({ title, desc }: { title: string; desc: string }) => (
    <div className="p-4 rounded-2xl border bg-white dark:bg-neutral-800">
      <div className="font-medium">{title}</div>
      <div className="text-sm opacity-80">{desc}</div>
    </div>
  );
  return (
    <div className="max-w-4xl mx-auto">
      <section className="text-center py-8">
        <h1 className="text-3xl font-extrabold">Creator AI – Hooks, Skripte, Captions in Sekunden</h1>
        <p className="mt-2 opacity-80">
          Persönliche Brand-Voice, Library & Credits. LLM (Grok 4 Fast) mit sicherem Fallback – 0€ Start.
        </p>
        <div className="mt-4 flex justify-center gap-3">
          <button onClick={onSignup} className="px-5 py-2 rounded-xl border bg-black text-white dark:bg-white dark:text-black">
            Kostenlos starten
          </button>
          <a href="#features" className="px-5 py-2 rounded-xl border">Mehr erfahren</a>
        </div>
      </section>

      <section id="features" className="grid md:grid-cols-3 gap-3 py-6">
        <Feature title="Hooks (7–9 Wörter)" desc="Kurz, punchy, deutsch. Automatisch an deine Marke angepasst." />
        <Feature title="Skripte & Captions" desc="Strukturierte 30–45s-Skripte und 3 Caption-Längen." />
        <Feature title="Library & Favoriten" desc="Alle Entwürfe speichern, filtern & ★ markieren." />
        <Feature title="Credits & Limits" desc="Serverseitig geschützt, kein Missbrauch – fair für alle." />
        <Feature title="Planner (optional)" desc="Slots planen & E-Mail-Reminder (Option B)." />
        <Feature title="Sicherer Fallback" desc="Bei LLM-Limit → lokaler Generator übernimmt automatisch." />
      </section>

      <section className="py-6 text-center">
        <div className="opacity-70 text-sm">Kein Risiko: Du behältst die Kontrolle – Texte bleiben bei dir.</div>
      </section>
    </div>
  );
}
