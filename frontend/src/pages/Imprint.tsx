export default function Imprint() {
  return (
    <div className="mx-auto max-w-3xl p-6 space-y-4">
      <h1 className="text-2xl font-bold">Impressum</h1>
      <p className="text-sm">
        Anbieter gemäß §5 TMG / Offenlegung gem. §25 MedienG (AT)
      </p>
      <p className="text-sm">
        <b>Firma:</b> Dein Firmenname<br/>
        <b>Adresse:</b> Musterstraße 1, 1010 Wien, Österreich<br/>
        <b>E-Mail:</b> <a className="underline" href="mailto:support@example.com">support@example.com</a>
      </p>
      <p className="text-sm opacity-80">
        Verantwortlich für den Inhalt: Dein Name. Umsatzsteuer-ID (falls vorhanden): ATU12345678.
      </p>
    </div>
  );
}
