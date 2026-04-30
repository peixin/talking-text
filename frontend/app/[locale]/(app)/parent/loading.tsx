export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8 border-b pb-6">
        <div className="mb-2 h-7 w-48 animate-pulse rounded bg-muted" />
        <div className="h-4 w-72 animate-pulse rounded bg-muted/60" />
      </div>

      <div className="mb-8">
        <div className="mb-4 flex items-center justify-between">
          <div className="h-5 w-24 animate-pulse rounded bg-muted" />
          <div className="h-4 w-16 animate-pulse rounded bg-muted/60" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="border-border flex items-center justify-between rounded-lg border p-4">
              <div className="h-5 w-24 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>

      <div className="mb-8">
        <div className="mb-4 h-5 w-20 animate-pulse rounded bg-muted" />
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="border-border flex flex-col items-start rounded-lg border p-5">
              <div className="mb-1 h-4 w-24 animate-pulse rounded bg-muted" />
              <div className="h-3.5 w-40 animate-pulse rounded bg-muted/60" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
