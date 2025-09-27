// NEU: Cloudflare Turnstile Wrapper
import { useEffect, useRef } from "react";

declare global { interface Window { turnstile: any } }

export default function Turnstile({ onToken }: { onToken: (t: string)=>void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    s.async = true;
    document.head.appendChild(s);
    s.onload = () => {
      window.turnstile?.render(ref.current, {
        sitekey: import.meta.env.VITE_TURNSTILE_SITEKEY,
        callback: (token: string) => onToken(token),
      });
    };
    return () => { document.head.removeChild(s); };
  }, []);

  return <div ref={ref} className="my-3" />;
}
