"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  BookOpen,
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  Plus,
  Sparkles,
  Zap,
} from "lucide-react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SCOPE_SOFT_CAP } from "@/lib/constants";
import type { GroupKind, GroupOut } from "@/lib/backend";
import { setSessionGroup } from "./actions";
import type { IngestTrigger } from "./IngestDrawerClient";

interface Props {
  sessionId: string;
  currentGroupId: string | null;
  groups: GroupOut[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied: (group: GroupOut | null) => void;
  onOpenIngest?: (trigger: IngestTrigger) => void;
}

const KIND_ICON: Record<GroupKind, typeof BookOpen> = {
  textbook_book: BookOpen,
  textbook_unit: BookOpen,
  textbook_lesson: BookOpen,
  personal_collection: Bookmark,
  quick_practice: Zap,
  review_set: Zap,
};

export function ScopeSwitcherClient({
  sessionId,
  currentGroupId,
  groups,
  open,
  onOpenChange,
  onApplied,
  onOpenIngest,
}: Props) {
  const t = useTranslations("Scope");
  const [isPending, startTransition] = useTransition();

  // Tree data derived once from the flat groups: parent→children map + recursive
  // descendant totals (a container's own item_count is often 0).
  const tree = useMemo(() => {
    const active = groups.filter((g) => !g.archived);
    const byId = new Map<string, GroupOut>(active.map((g) => [g.id, g]));
    const childrenMap = new Map<string, GroupOut[]>();
    active.forEach((g) => {
      if (g.parent_id && byId.has(g.parent_id)) {
        const list = childrenMap.get(g.parent_id) || [];
        list.push(g);
        childrenMap.set(g.parent_id, list);
      }
    });
    const totals = new Map<string, number>();
    function totalOf(id: string, seen: Set<string>): number {
      if (totals.has(id)) return totals.get(id)!;
      if (seen.has(id)) return 0; // cycle guard
      seen.add(id);
      const self = byId.get(id)?.item_count || 0;
      const sum =
        self +
        (childrenMap.get(id) || []).reduce((acc, k) => acc + totalOf(k.id, new Set(seen)), 0);
      totals.set(id, sum);
      return sum;
    }
    active.forEach((g) => totalOf(g.id, new Set()));
    return { active, byId, childrenMap, totals };
  }, [groups]);

  // The ancestor chain of the current selection — auto-expanded so the selected node
  // is always visible when the dialog opens.
  const pathIds = useMemo(() => {
    const set = new Set<string>();
    let cur = currentGroupId ? tree.byId.get(currentGroupId) : undefined;
    while (cur) {
      if (set.has(cur.id)) break;
      set.add(cur.id);
      cur = cur.parent_id ? tree.byId.get(cur.parent_id) : undefined;
    }
    return set;
  }, [currentGroupId, tree]);

  // Collapsed by default (keeps the list short); seed open nodes to the current path
  // each time the dialog opens.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!open) return;
    // Defer the seed to the next tick — setting state synchronously in an effect body
    // triggers cascading renders (react-hooks/set-state-in-effect).
    const timer = setTimeout(() => setExpanded(new Set(pathIds)), 0);
    return () => clearTimeout(timer);
  }, [open, pathIds]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Depth-first flatten, honoring expansion and HIDING empty subtrees (total === 0).
  const rows = useMemo(() => {
    const { childrenMap, totals } = tree;
    const visibleChildren = (id: string) =>
      (childrenMap.get(id) || []).filter((c) => (totals.get(c.id) || 0) > 0);

    const out: {
      group: GroupOut;
      depth: number;
      direct: number;
      total: number;
      hasChildren: boolean;
    }[] = [];
    function walk(g: GroupOut, depth: number, seen: Set<string>) {
      if (seen.has(g.id)) return; // cycle guard
      seen.add(g.id);
      const kids = visibleChildren(g.id);
      out.push({
        group: g,
        depth,
        direct: g.item_count || 0,
        total: totals.get(g.id) || 0,
        hasChildren: kids.length > 0,
      });
      if (kids.length > 0 && expanded.has(g.id)) {
        kids.forEach((c) => walk(c, depth + 1, seen));
      }
    }
    tree.active
      .filter((g) => (!g.parent_id || !tree.byId.has(g.parent_id)) && (totals.get(g.id) || 0) > 0)
      .forEach((r) => walk(r, 0, new Set()));
    return out;
  }, [tree, expanded]);

  function applyGroup(group: GroupOut | null) {
    startTransition(async () => {
      try {
        await setSessionGroup(sessionId, group?.id ?? null);
        onApplied(group);
        onOpenChange(false);
      } catch {
        // Surface a soft error inline; current scope keeps its old value.
      }
    });
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          className={cn(
            "fixed inset-0 z-50 bg-black/30 duration-150",
            "data-open:animate-in data-open:fade-in-0",
            "data-closed:animate-out data-closed:fade-out-0",
          )}
        />
        <DialogPrimitive.Popup
          className={cn(
            "fixed top-1/2 left-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2",
            "bg-popover text-popover-foreground ring-foreground/10 rounded-xl border shadow-lg ring-1",
            "duration-150 outline-none",
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
            "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          )}
        >
          <header className="border-b px-4 py-3">
            <DialogPrimitive.Title className="text-sm font-medium">
              {t("title")}
            </DialogPrimitive.Title>
          </header>

          <ul className="max-h-[60vh] divide-y overflow-y-auto">
            <li className="bg-muted/20 border-b p-3">
              <button
                type="button"
                onClick={() => {
                  onOpenIngest?.("camera");
                  onOpenChange(false);
                }}
                className={cn(
                  "flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5",
                  "border border-indigo-500/20 bg-gradient-to-r from-indigo-500/10 to-purple-500/10 text-indigo-600 hover:from-indigo-500/20 hover:to-purple-500/20 dark:text-indigo-400",
                  "text-xs font-semibold tracking-wide shadow-sm transition-all duration-300 hover:scale-[1.01] active:scale-[0.99]",
                )}
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{t("ingest_new_material")}</span>
              </button>
            </li>
            <ScopeRow
              icon={<Sparkles className="text-muted-foreground h-4 w-4" />}
              label={t("free_practice")}
              hint={t("free_practice_hint")}
              selected={currentGroupId === null}
              disabled={isPending}
              onClick={() => applyGroup(null)}
            />
            {rows.length === 0 && (
              <li className="text-muted-foreground px-4 py-6 text-center text-xs">
                {t("no_groups_yet")}
              </li>
            )}
            {rows.map(({ group: g, depth, direct, total, hasChildren }) => {
              const Icon = KIND_ICON[g.kind] ?? Bookmark;
              const warn = total > SCOPE_SOFT_CAP;
              return (
                <ScopeRow
                  key={g.id}
                  depth={depth}
                  hasChildren={hasChildren}
                  expanded={expanded.has(g.id)}
                  onToggle={() => toggle(g.id)}
                  icon={<Icon className="text-muted-foreground h-4 w-4" />}
                  label={g.name}
                  hint={
                    total > direct
                      ? t("items_count_total", { count: total })
                      : t("items_count", { count: direct })
                  }
                  warnText={warn ? t("too_many", { cap: SCOPE_SOFT_CAP }) : undefined}
                  selected={currentGroupId === g.id}
                  disabled={isPending}
                  onClick={() => applyGroup(g)}
                />
              );
            })}
          </ul>

          <footer className="bg-muted/30 flex justify-end border-t px-4 py-2">
            <DialogPrimitive.Close
              render={
                <Button variant="ghost" size="sm">
                  {t("close")}
                </Button>
              }
            />
          </footer>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function ScopeRow({
  icon,
  label,
  hint,
  warnText,
  selected,
  disabled,
  depth = 0,
  hasChildren = false,
  expanded = false,
  onToggle,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  warnText?: string;
  selected: boolean;
  disabled: boolean;
  depth?: number;
  hasChildren?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  onClick: () => void;
}) {
  return (
    <li
      className="flex items-stretch"
      style={depth > 0 ? { paddingLeft: `${depth * 1.15}rem` } : undefined}
    >
      {hasChildren ? (
        <button
          type="button"
          onClick={onToggle}
          aria-label={expanded ? "collapse" : "expand"}
          className="text-muted-foreground hover:text-foreground flex w-7 shrink-0 items-center justify-center"
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      ) : (
        <span className="w-7 shrink-0" />
      )}
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || selected}
        className={cn(
          "flex flex-1 items-center gap-3 py-3 pr-4 text-left text-sm transition",
          selected ? "bg-muted/60 cursor-default" : "hover:bg-muted",
          disabled && !selected ? "opacity-50" : "",
        )}
      >
        {icon}
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{label}</div>
          {hint && <div className="text-muted-foreground text-xs">{hint}</div>}
          {warnText && (
            <div className="flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-500">
              <AlertTriangle className="h-3 w-3" />
              {warnText}
            </div>
          )}
        </div>
        {selected && <Check className="text-primary h-4 w-4" />}
      </button>
    </li>
  );
}
