import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The app-wide bordered container ("panel") — the plain `rounded-xl border`
 * box used for list rows, settings sections, and dashboard blocks.
 *
 * Not shadcn `Card`: Card's slot structure (own gap + per-slot padding) is for
 * title/description/footer cards; a Panel is just a styled box. Use Card when
 * the content genuinely has that structure.
 */
export function Panel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("border-border bg-card rounded-xl border p-4", className)} {...props} />
  );
}
