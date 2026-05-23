"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { BookOpen, Bookmark, Check, Sparkles, Zap } from "lucide-react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GroupKind, GroupOut } from "@/lib/backend";
import { setSessionGroup } from "./actions";

interface Props {
  sessionId: string;
  currentGroupId: string | null;
  groups: GroupOut[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied: (group: GroupOut | null) => void;
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
}: Props) {
  const t = useTranslations("Scope");
  const [isPending, startTransition] = useTransition();

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
            <ScopeRow
              icon={<Sparkles className="text-muted-foreground h-4 w-4" />}
              label={t("free_practice")}
              hint={t("free_practice_hint")}
              selected={currentGroupId === null}
              disabled={isPending}
              onClick={() => applyGroup(null)}
            />
            {groups.length === 0 && (
              <li className="text-muted-foreground px-4 py-6 text-center text-xs">
                {t("no_groups_yet")}
              </li>
            )}
            {groups.map((g) => {
              const Icon = KIND_ICON[g.kind] ?? Bookmark;
              return (
                <ScopeRow
                  key={g.id}
                  icon={<Icon className="text-muted-foreground h-4 w-4" />}
                  label={g.name}
                  hint={t("items_count", { count: g.item_count })}
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
  selected,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || selected}
        className={cn(
          "flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition",
          selected ? "bg-muted/60 cursor-default" : "hover:bg-muted",
          disabled && !selected ? "opacity-50" : "",
        )}
      >
        {icon}
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{label}</div>
          {hint && <div className="text-muted-foreground text-xs">{hint}</div>}
        </div>
        {selected && <Check className="text-primary h-4 w-4" />}
      </button>
    </li>
  );
}
