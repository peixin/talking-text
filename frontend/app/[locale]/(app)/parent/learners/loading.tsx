export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center gap-4">
        <div className="bg-muted/60 h-4 w-12 animate-pulse rounded" />
        <div className="bg-muted h-6 w-24 animate-pulse rounded" />
      </div>

      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="border-border flex items-center justify-between rounded-lg border p-4"
          >
            <div className="bg-muted h-5 w-28 animate-pulse rounded" />
            <div className="flex gap-2">
              <div className="bg-muted/60 h-8 w-16 animate-pulse rounded" />
              <div className="bg-muted/60 h-8 w-16 animate-pulse rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
