// NEU: src/components/CopyButton.tsx
import { Clipboard, Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function CopyButton({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setOk(true);
        toast.success("Kopiert!");
        setTimeout(() => setOk(false), 1200);
      }}
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-sm hover:bg-muted"
      aria-label="Copy"
    >
      {ok ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
      Copy
    </button>
  );
}
