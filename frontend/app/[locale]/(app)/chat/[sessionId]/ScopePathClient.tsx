"use client";

import { useEffect, useRef, useState } from "react";

export interface Crumb {
  id: string;
  name: string;
}

/**
 * Renders a root → current breadcrumb that shows the FULL path when it fits, and
 * collapses the middle to an ellipsis (keeping the root and the tail) when it doesn't.
 *
 * It measures against the real available width via ResizeObserver, off an invisible
 * full-width copy, so "enough space" is decided by actual layout — not a fixed count.
 */
export function ScopePath({ chain }: { chain: Crumb[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  // Indices of `chain` to render (ascending). Starts as "show all"; the observer
  // narrows it once widths are known.
  const [shown, setShown] = useState<number[]>(() => chain.map((_, i) => i));

  useEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const compute = () => {
      const n = chain.length;
      if (n <= 2) {
        setShown(chain.map((_, i) => i));
        return;
      }
      const crumbEls = Array.from(measure.querySelectorAll<HTMLElement>("[data-crumb]"));
      const sepEl = measure.querySelector<HTMLElement>("[data-sep]");
      const ellEl = measure.querySelector<HTMLElement>("[data-ell]");
      if (crumbEls.length !== n) return;

      const w = crumbEls.map((el) => el.offsetWidth);
      const sep = sepEl?.offsetWidth ?? 16;
      const ell = ellEl?.offsetWidth ?? 12;
      const avail = container.clientWidth;

      const full = w.reduce((a, b) => a + b, 0) + (n - 1) * sep;
      if (full <= avail) {
        setShown(w.map((_, i) => i));
        return;
      }

      // Keep root (0) + current (n-1); fill middle from the tail side while it fits.
      // Layout when collapsed: root › … › [middle…] › current
      const keep = new Set<number>([0, n - 1]);
      let used = w[0] + sep + ell + sep + w[n - 1];
      for (let i = n - 2; i >= 1; i--) {
        const extra = w[i] + sep;
        if (used + extra <= avail) {
          keep.add(i);
          used += extra;
        } else {
          break;
        }
      }
      setShown([...keep].sort((a, b) => a - b));
    };

    const ro = new ResizeObserver(compute);
    ro.observe(container);
    // ResizeObserver fires once on observe, so the initial measurement runs without a
    // synchronous setState in the effect body.
    return () => ro.disconnect();
  }, [chain]);

  const crumbClass = (i: number) =>
    i === chain.length - 1
      ? "text-foreground shrink-0 font-medium"
      : "text-muted-foreground/70 shrink-0";

  const Separator = () => <span className="text-muted-foreground/40 px-1 select-none">›</span>;

  // Guard against stale indices between a `chain` change and the next measurement
  // (the lazy initial/previous `shown` may reference indices the new chain lacks).
  const valid = shown.filter((i) => i >= 0 && i < chain.length);
  const effective = valid.length > 0 ? valid : chain.map((_, i) => i);

  return (
    <>
      {/* Invisible full-width copy used only for measuring each crumb + separator. */}
      <div
        ref={measureRef}
        aria-hidden
        className="pointer-events-none invisible absolute top-0 left-0 flex items-center whitespace-nowrap"
      >
        {chain.map((c, i) => (
          <span key={c.id} className="flex items-center">
            {i > 0 && (
              <span data-sep className="px-1">
                ›
              </span>
            )}
            <span data-crumb className={i === chain.length - 1 ? "font-medium" : ""}>
              {c.name}
            </span>
          </span>
        ))}
        <span data-ell>…</span>
      </div>

      {/* Visible, responsive path. */}
      <div
        ref={containerRef}
        className="flex min-w-0 flex-1 items-center overflow-hidden whitespace-nowrap"
      >
        {effective.map((idx, k) => {
          const gapBefore = k > 0 && idx !== effective[k - 1] + 1;
          return (
            <span key={chain[idx].id} className="flex items-center">
              {k > 0 && <Separator />}
              {gapBefore && (
                <>
                  <span
                    className="text-muted-foreground/60 select-none"
                    title={chain
                      .slice(effective[k - 1] + 1, idx)
                      .map((c) => c.name)
                      .join(" › ")}
                  >
                    …
                  </span>
                  <Separator />
                </>
              )}
              <span className={crumbClass(idx)}>{chain[idx].name}</span>
            </span>
          );
        })}
      </div>
    </>
  );
}
