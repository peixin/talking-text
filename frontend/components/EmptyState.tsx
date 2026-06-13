import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * App-wide empty-state box — dashed border, centered muted message, optional
 * action below. Use for "no items yet" placeholders, not for interactive
 * drop-zones (those stay custom).
 */
export function EmptyState({
  className,
  action,
  children,
}: {
  className?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "border-border text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm",
        className,
      )}
    >
      <p>{children}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
