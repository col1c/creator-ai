import { useEffect, useState } from "react";
import { supabase } from "./lib/supabaseClient";

type BrandVoice = {
  tone?: "locker"|"seriös"|"motiviert"|"sachlich";
  emojis?: boolean;
  cta?: string[];
  forbidden?: string[];
  hashtags_base?: string[];
};

export default function Settings() {
  const [loading, setLoading] = useState(true);
  const [handle, setHandle] = useState("");
  const [niche, setNiche] = useState("");
  const [target, setTarget] = useState("");
  const [tone, setTone] = useState<BrandVoice["tone"]>("locker");
  const [emojis, setEmojis] = useState(true);
  const [cta, setCta] = useState("Folge für mehr.\nSpeichere & probier’s heute aus.\nFrag in den Kommentaren.");
  const [forbidden, setForbidden] = useState("");
  const [hashtags, setHashtags] = useState("#shorts\n#tiktok\n#reels");

  const load = async () => {
    setLoading(true);
    const { data: session } = await supabase.auth.getSession();
    if (!session.session) return setLoading(false);

    const { data, error } = await supabase
      .from("users_public")
      .select("handle,niche,target,brand_voice")
      .eq("user_id", session.session.user.id)
      .maybeSingle();

    if (!error && data) {
      setHandle(data.handle || "");
      setNiche(data.niche || "");
      setTarget(data.target || "");
      const v = (data.brand_voice || {}) as BrandVoice;
      setTone((v.tone || "locker"));
      setEmojis(v.emojis !== false);
      setCta((v.cta && v.cta.length ? v.cta : ["Folge für mehr.", "Speichere & probier’s heute aus.", "Frag in den Kommentaren."]).join("\n"));
      setForbidden((v.forbidden || []).join("\n"));
      setHashtags((v.hashtags_base || ["#shorts","#tiktok","#reels"]).join("\n"));
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    const { data: session } = await supabase.auth.getSession();
    if (!session.session) return alert("Nicht eingeloggt.");
    const uid = session.session.user.id;

    const brand_voice: BrandVoice = {
      tone,
      emojis,
      cta: cta.split("\n").map(s => s.trim()).filter(Boolean),
      forbidden: forbidden.split("\n").map(s => s.trim()).filter(Boolean),
      hashtags_base: hashtags.split("\n").map(s => s.trim()).filter(Boolean),
    };

    const { error } = await supabase.from("users_public").upsert({
      user_id: uid,
      handle, niche, target,
      brand_voice
    }, { onConflict: "user_id" });

    if (error) return alert(error.message);
    alert("Gespeichert ✅");
  };

  if (loading) return <div className="p-4 rounded-xl border">Lade Einstellungen…</div>;

  return (
    <div className="p-4 rounded-2xl border bg-white dark:bg-neutral-800 space-y-3">
      <h2 className="text-lg font-semibold">Einstellungen / Brand-Voice</h2>
      <div className="grid md:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs uppercase mb-1">Handle</label>
          <input className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-neutral-700"
                 value={handle} onChange={e=>setHandle(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs uppercase mb-1">Nische (Default)</label>
          <input className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-neutral-700"
                 value={niche} onChange={e=>setNiche(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs uppercase mb-1">Zielgruppe</label>
          <input className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-neutral-700"
                 value={target} onChange={e=>setTarget(e.target.value)} />
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs uppercase mb-1">Ton</label>
          <select className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-neutral-700"
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
        <div>
          <label className="block text-xs uppercase mb-1">CTA (eine je Zeile)</label>
          <textarea className="w-full h-28 px-3 py-2 rounded-lg border bg-white dark:bg-neutral-700"
                    value={cta} onChange={e=>setCta(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs uppercase mb-1">Verbotene Wörter (eine je Zeile)</label>
          <textarea className="w-full h-28 px-3 py-2 rounded-lg border bg-white dark:bg-neutral-700"
                    value={forbidden} onChange={e=>setForbidden(e.target.value)} />
        </div>
      </div>

      <div>
        <label className="block text-xs uppercase mb-1">Basis-Hashtags (eine je Zeile)</label>
        <textarea className="w-full h-24 px-3 py-2 rounded-lg border bg-white dark:bg-neutral-700"
                  value={hashtags} onChange={e=>setHashtags(e.target.value)} />
      </div>

      <button onClick={save} className="px-4 py-2 rounded-xl border bg-black text-white dark:bg-white dark:text-black">
        Speichern
      </button>
    </div>
  );
}
