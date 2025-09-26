// NEU: src/components/CreditsBadge.tsx
export default function CreditsBadge({
  remaining,
  cached,
}: { remaining?: number | string; cached?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="px-2 py-0.5 text-xs rounded-full border">
        Credits: {remaining ?? "—"}
      </span>
      {cached && (
        <span className="px-2 py-0.5 text-xs rounded-full border">
          Cache
        </span>
      )}
    </div>
  );
}
