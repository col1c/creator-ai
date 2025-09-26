// NEU: src/components/LoadingCard.tsx
export default function LoadingCard() {
  return (
    <div className="border rounded-2xl p-4 animate-pulse space-y-3">
      <div className="h-4 w-1/3 bg-muted rounded" />
      <div className="h-3 w-full bg-muted rounded" />
      <div className="h-3 w-5/6 bg-muted rounded" />
      <div className="h-3 w-2/3 bg-muted rounded" />
    </div>
  );
}
