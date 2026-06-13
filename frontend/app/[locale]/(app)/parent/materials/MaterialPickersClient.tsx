"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, Loader2, Plus, X } from "lucide-react";

import { cn } from "@/lib/utils";
import type { GroupOut } from "@/lib/backend";

// ── Known kind constants (still drive icon & default label) ──────────────────

const BUILTIN_KIND_KEYS = new Set([
  "textbook_book",
  "textbook_unit",
  "textbook_lesson",
  "personal_collection",
  "quick_practice",
  "review_set",
  "generic",
]);

/** Return a displayable label for a kind string — localized if it's a known
 *  constant, otherwise the raw value the user/LLM picked. */
export function useKindLabel() {
  const t = useTranslations("Materials");
  return (kind: string) => {
    switch (kind) {
      case "textbook_book":
        return t("kind_textbook_book");
      case "textbook_unit":
        return t("kind_textbook_unit");
      case "textbook_lesson":
        return t("kind_textbook_lesson");
      case "personal_collection":
        return t("kind_personal_collection");
      case "quick_practice":
        return t("kind_quick_practice");
      case "review_set":
        return t("kind_review_set");
      case "tag":
      case "generic":
        return t("kind_tag");
      default:
        return kind;
    }
  };
}

// ── KindInput — free text with chip suggestions ──────────────────────────────

interface KindInputProps {
  value: string;
  onChange: (next: string) => void;
  /** All groups in the account; we mine their kinds for suggestions. */
  groups: GroupOut[];
  placeholder?: string;
  className?: string;
}

export function KindInput({ value, onChange, groups, placeholder, className }: KindInputProps) {
  const t = useTranslations("MaterialPickers");
  const kindLabel = useKindLabel();

  // Suggestions = used kinds in the account ∪ built-in kinds. Display the
  // localized label but the stored value is what the user clicked. Dedupe.
  const suggestions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const k of BUILTIN_KIND_KEYS) {
      seen.set(k, kindLabel(k));
    }
    for (const g of groups) {
      if (!g.kind || seen.has(g.kind)) continue;
      seen.set(g.kind, kindLabel(g.kind));
    }
    return Array.from(seen.entries()).map(([key, label]) => ({ key, label }));
  }, [groups, kindLabel]);

  return (
    <div className={cn("space-y-2", className)}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? t("kind_placeholder")}
        maxLength={30}
        className="border-input bg-background focus:ring-ring w-full rounded-lg border px-3 py-1.5 text-sm outline-none focus:ring-1"
      />
      <div className="flex flex-wrap gap-1.5">
        {suggestions.map((s) => {
          const active = s.key === value;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => onChange(s.key)}
              className={cn(
                "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                active
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "text-muted-foreground hover:border-primary/20 hover:bg-primary/5 hover:text-primary",
              )}
            >
              {s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── ParentCombobox — search existing + inline create ─────────────────────────

interface ParentComboboxProps {
  value: string | null;
  onChange: (parentId: string | null) => void;
  groups: GroupOut[];
  /** Disabled ids (the group itself + descendants — to prevent cycles). */
  disabledIds?: Set<string>;
  /** Called when the user picks "+ new parent" — must create the group and
   *  return its id so we can select it. */
  onCreateParent: (name: string) => Promise<{ id: string; kind: string } | null>;
  className?: string;
}

interface GroupPathEntry extends GroupOut {
  path: string; // "Book > Unit > ..."
}

function computePaths(groups: GroupOut[]): Map<string, GroupPathEntry> {
  const byId = new Map(groups.map((g) => [g.id, g] as const));
  const pathOf = (id: string, visited = new Set<string>()): string => {
    if (visited.has(id)) return "";
    visited.add(id);
    const g = byId.get(id);
    if (!g) return "";
    if (!g.parent_id) return g.name;
    return `${pathOf(g.parent_id, visited)} / ${g.name}`;
  };
  const out = new Map<string, GroupPathEntry>();
  for (const g of groups) out.set(g.id, { ...g, path: pathOf(g.id) });
  return out;
}

export function ParentCombobox({
  value,
  onChange,
  groups,
  disabledIds,
  onCreateParent,
  className,
}: ParentComboboxProps) {
  const t = useTranslations("MaterialPickers");
  const kindLabel = useKindLabel();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const pathMap = useMemo(() => computePaths(groups), [groups]);
  const selected = value ? (pathMap.get(value) ?? null) : null;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const trimmedQuery = query.trim();
  const matches = useMemo(() => {
    const q = trimmedQuery.toLowerCase();
    return Array.from(pathMap.values())
      .filter((g) => !disabledIds?.has(g.id))
      .filter((g) => {
        if (!q) return true;
        return g.name.toLowerCase().includes(q) || g.path.toLowerCase().includes(q);
      })
      .slice(0, 50);
  }, [pathMap, trimmedQuery, disabledIds]);

  const exactMatch = useMemo(
    () =>
      trimmedQuery.length > 0 &&
      Array.from(pathMap.values()).some(
        (g) => g.name.trim().toLowerCase() === trimmedQuery.toLowerCase(),
      ),
    [pathMap, trimmedQuery],
  );

  async function handleCreate() {
    if (!trimmedQuery || exactMatch || creating) return;
    setCreating(true);
    const created = await onCreateParent(trimmedQuery);
    setCreating(false);
    if (created) {
      onChange(created.id);
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div ref={wrapperRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        className="border-input bg-background hover:border-foreground/30 focus:ring-ring flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-left text-sm outline-none focus:ring-1"
      >
        <span className={cn("truncate", !selected && "text-muted-foreground")}>
          {selected ? selected.path : t("parent_none")}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {selected && (
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
              }}
              className="text-muted-foreground hover:text-foreground rounded p-0.5"
              title={t("parent_clear")}
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
          <ChevronDown
            className={cn(
              "text-muted-foreground h-3.5 w-3.5 transition-transform",
              open && "rotate-180",
            )}
          />
        </div>
      </button>

      {open && (
        <div className="bg-popover absolute z-30 mt-1 w-full overflow-hidden rounded-lg border shadow-lg">
          <div className="border-b p-2">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("parent_search_placeholder")}
              className="bg-background w-full rounded border px-2 py-1 text-sm outline-none focus:ring-1"
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {matches.length === 0 && !trimmedQuery && (
              <p className="text-muted-foreground px-3 py-2 text-xs">{t("parent_no_groups_yet")}</p>
            )}

            {matches.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => {
                  onChange(g.id);
                  setOpen(false);
                  setQuery("");
                }}
                className={cn(
                  "hover:bg-muted flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm",
                  value === g.id && "bg-muted/60",
                )}
              >
                <span className="truncate">{g.path}</span>
                <span className="text-muted-foreground shrink-0 text-[10px]">
                  {kindLabel(g.kind)}
                </span>
              </button>
            ))}

            {trimmedQuery && !exactMatch && (
              <button
                type="button"
                onClick={handleCreate}
                disabled={creating}
                className="text-primary hover:bg-primary/5 flex w-full items-center gap-2 border-t px-3 py-2 text-left text-sm"
              >
                {creating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                {t("parent_create_as", { name: trimmedQuery })}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Build a Set of (group + descendants) ids to disable in the picker ───────

export function descendantIds(rootId: string, groups: GroupOut[]): Set<string> {
  const out = new Set<string>([rootId]);
  // Simple BFS — groups list is small (a few dozen).
  let changed = true;
  while (changed) {
    changed = false;
    for (const g of groups) {
      if (g.parent_id && out.has(g.parent_id) && !out.has(g.id)) {
        out.add(g.id);
        changed = true;
      }
    }
  }
  return out;
}
