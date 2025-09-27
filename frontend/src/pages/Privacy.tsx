export default function Privacy() {
  return (
    <div className="mx-auto max-w-3xl p-6 space-y-4">
      <h1 className="text-2xl font-bold">Datenschutzerklärung</h1>
      <p className="opacity-80 text-sm">
        Wir verarbeiten nur die für den Dienst notwendigen Daten (E-Mail, Profilangaben, generierte Inhalte).
        Keine Weitergabe an Dritte außer Auftragsverarbeitern (z.&nbsp;B. Supabase, Render, Vercel, Mailgun).
      </p>
      <h2 className="text-lg font-semibold">Welche Daten?</h2>
      <ul className="list-disc pl-6 text-sm space-y-1">
        <li>Account: E-Mail, Auth-ID</li>
        <li>Profil: Nische, Brand-Voice</li>
        <li>Inhalte: Generations, Templates, Planner-Slots</li>
        <li>Protokolle: usage_log für Fehleranalyse (minimal)</li>
      </ul>
      <h2 className="text-lg font-semibold">Speicherdauer</h2>
      <p className="text-sm">
        Bis zur Löschung des Accounts bzw. solange erforderlich. Export und Löschung
        sind jederzeit in den <b>Einstellungen</b> möglich.
      </p>
      <h2 className="text-lg font-semibold">Kontakt</h2>
      <p className="text-sm">
        Betreiber: <i>Dein Name / Firma</i><br />
        E-Mail: <a className="underline" href="mailto:support@example.com">support@example.com</a>
      </p>
    </div>
  );
}
