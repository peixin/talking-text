export default function Loading() {
  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* Sidebar skeleton */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-border">
        <div className="px-3 py-2">
          <div className="h-8 animate-pulse rounded-md bg-muted" />
        </div>
        <nav className="flex-1 space-y-0.5 overflow-hidden px-2 py-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-1 rounded-md px-2 py-2">
              <div className="h-3.5 w-3/4 animate-pulse rounded bg-muted" />
              <div className="h-2.5 w-1/2 animate-pulse rounded bg-muted/60" />
            </div>
          ))}
        </nav>
      </aside>

      {/* Main area skeleton */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Title bar */}
        <div className="flex items-center border-b border-border px-4 py-2.5">
          <div className="h-4 w-32 animate-pulse rounded bg-muted" />
        </div>

        {/* Messages */}
        <div className="flex flex-1 flex-col gap-3 px-4 py-4">
          <div className="ml-auto h-10 w-2/3 animate-pulse rounded-2xl bg-muted" />
          <div className="h-12 w-3/4 animate-pulse rounded-2xl bg-muted" />
          <div className="ml-auto h-8 w-1/2 animate-pulse rounded-2xl bg-muted" />
          <div className="h-14 w-4/5 animate-pulse rounded-2xl bg-muted" />
        </div>

        {/* Record button */}
        <div className="flex flex-col items-center gap-2 border-t border-border px-4 py-4">
          <div className="h-16 w-16 animate-pulse rounded-full bg-muted" />
          <div className="h-3 w-24 animate-pulse rounded bg-muted/60" />
        </div>
      </div>
    </div>
  );
}
