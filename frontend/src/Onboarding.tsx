import { useEffect, useState } from "react";
import { supabase } from "./lib/supabaseClient";

type Voice = {
  tone?: "locker"|"seriös"|"motiviert"|"sachlich";
  emojis?: boolean;
  cta?: string[];
  forbidden?: string[];
  hashtags_base?: string[];
};

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);

  const [handle, setHandle] = useState("");
  const [niche, setNiche] = useState("");
  const [target, setTarget] = useState("");
  const [tone, setTone] = useState<Voice["tone"]>("locker");
  const [emojis, setEmojis] = useState(true);
  const [cta, setCta] = useState("Folge für mehr.\nSpeichere & probier’s heute aus.\nFrag in den Kommentaren.");
  const [forbidden, setForbidden] = useState("");
  const [hashtags, setHashtags] = useState("#shorts\n#tiktok\n#reels");

  useEffect(() => {
    // vorhandene Defaults laden
    (async () => {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) return;
      const { data } = await supabase
        .from("users_public")
        .select("handle,niche,target,brand_voice")
        .eq("user_id", session.session.user.id)
        .maybeSingle();
      if (data) {
        setHandle(data.handle || "");
        setNiche(data.niche || "");
        setTarget(data.target || "");
        const v = (data.brand_voice || {}) as Voice;
        setTone((v.tone || "locker"));
        setEmojis(v.emojis !== false);
        setCta((v.cta && v.cta.length ? v.cta : ["Folge für mehr.", "Speichere & probier’s heute aus.", "Frag in den Kommentaren."]).join("\n"));
        setForbidden((v.forbidden || []).join("\n"));
        setHashtags((v.hashtags_base || ["#shorts","#tiktok","#reels"]).join("\n"));
      }
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) throw new Error("Nicht eingeloggt.");
      const uid = session.session.user.id;

      const brand_voice: Voice = {
        tone,
        emojis,
        cta: cta.split("\n").map(s => s.trim()).filter(Boolean),
        forbidden: forbidden.split("\n").map(s => s.trim()).filter(Boolean),
        hashtags_base: hashtags.split("\n").map(s => s.trim()).filter(Boolean),
      };

      const { error } = await supabase.from("users_public").upsert({
        user_id: uid,
        handle, niche, target,
        brand_voice,
        onboarding_done: true
      }, { onConflict: "user_id" });

      if (error) throw error;
      onDone();
    } catch (e: any) {
      alert(e?.message || "Konnte Onboarding nicht speichern.");
    } finally {
      setSaving(false);
    }
  };

  const StepDots = () => (
    <div className="flex gap-2 justify-center my-2">
      {[1,2,3].map(i => <div key={i} className={"w-2 h-2 rounded-full " + (i===step ? "bg-black dark:bg-white" : "bg-neutral-400")}/>)}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl rounded-2xl border bg-white dark:bg-neutral-900 p-5">
        <h2 className="text-lg font-semibold">Willkommen! <span className="opacity-70">3 kurze Schritte</span></h2>
        <StepDots />
        {step === 1 && (
          <div className="grid md:grid-cols-3 gap-3 mt-3">
            <div className="md:col-span-1">
              <label className="block text-xs uppercase mb-1">Handle</label>
              <input className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-neutral-800"
                     value={handle} onChange={e=>setHandle(e.target.value)} />
            </div>
            <div className="md:col-span-1">
              <label className="block text-xs uppercase mb-1">Nische</label>
              <input className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-neutral-800"
                     value={niche} onChange={e=>setNiche(e.target.value)} placeholder="z. B. fitness, coding" />
            </div>
            <div className="md:col-span-1">
              <label className="block text-xs uppercase mb-1">Zielgruppe</label>
              <input className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-neutral-800"
                     value={target} onChange={e=>setTarget(e.target.value)} placeholder="z. B. Anfänger, Selbstständige" />
            </div>
          </div>
        )}
        {step === 2 && (
          <div className="grid md:grid-cols-3 gap-3 mt-3">
            <div>
              <label className="block text-xs uppercase mb-1">Ton</label>
              <select className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-neutral-800"
                      value={tone} onChange={e=>setTone(e.target.value as any)}>
                <option value="locker">locker</option>
                <option value="seriös">seriös</option>
                <option value="motiviert">motiviert</option>
                <option value="sachlich">sachlich</option>
              </select>
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={emojis} onChange={e=>setEmojis(e.target.checked)} />
                Emojis erlauben
              </label>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs uppercase mb-1">CTA (eine je Zeile)</label>
              <textarea className="w-full h-28 px-3 py-2 rounded-lg border bg-white dark:bg-neutral-800"
                        value={cta} onChange={e=>setCta(e.target.value)} />
            </div>
          </div>
        )}
        {step === 3 && (
          <div className="grid md:grid-cols-2 gap-3 mt-3">
            <div>
              <label className="block text-xs uppercase mb-1">Verbotene Wörter</label>
              <textarea className="w-full h-28 px-3 py-2 rounded-lg border bg-white dark:bg-neutral-800"
                        value={forbidden} onChange={e=>setForbidden(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs uppercase mb-1">Basis-Hashtags</label>
              <textarea className="w-full h-28 px-3 py-2 rounded-lg border bg-white dark:bg-neutral-800"
                        value={hashtags} onChange={e=>setHashtags(e.target.value)} />
            </div>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between">
          <button onClick={() => onDone()} className="text-sm opacity-80">Später</button>
          <div className="flex gap-2">
            {step > 1 && <button onClick={()=>setStep(s=>s-1)} className="px-3 py-1 rounded-lg border">Zurück</button>}
            {step < 3 && <button onClick={()=>setStep(s=>s+1)} className="px-3 py-1 rounded-lg border">Weiter</button>}
            {step === 3 && (
              <button onClick={save} disabled={saving}
                      className="px-4 py-2 rounded-xl border bg-black text-white dark:bg-white dark:text-black">
                {saving ? "Speichere…" : "Fertig"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
