"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  Archive,
  ArchiveRestore,
  BookOpen,
  Bookmark,
  Check,
  Pencil,
  Trash2,
  X,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GroupKind, GroupOut } from "@/lib/backend";
import { archiveGroup, deleteGroup, renameGroup } from "./actions";

const KIND_ICON: Record<GroupKind, typeof BookOpen> = {
  textbook_book: BookOpen,
  textbook_unit: BookOpen,
  textbook_lesson: BookOpen,
  personal_collection: Bookmark,
  quick_practice: Zap,
  review_set: Zap,
};

interface Props {
  groups: GroupOut[];
}

export function MaterialsClient({ groups: initialGroups }: Props) {
  const t = useTranslations("Materials");
  const [groups, setGroups] = useState<GroupOut[]>(initialGroups);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  const active = groups.filter((g) => !g.archived);
  const archived = groups.filter((g) => g.archived);

  function startEdit(g: GroupOut) {
    setEditingId(g.id);
    setDraft(g.name);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft("");
  }

  function commitRename(id: string) {
    const trimmed = draft.trim();
    if (!trimmed) {
      cancelEdit();
      return;
    }
    setBusy(id);
    startTransition(async () => {
      const res = await renameGroup(id, trimmed);
      if (res.ok) {
        setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, name: trimmed } : g)));
      }
      setBusy(null);
      cancelEdit();
    });
  }

  function toggleArchive(g: GroupOut) {
    setBusy(g.id);
    startTransition(async () => {
      const res = await archiveGroup(g.id, !g.archived);
      if (res.ok) {
        setGroups((prev) => prev.map((x) => (x.id === g.id ? { ...x, archived: !x.archived } : x)));
      }
      setBusy(null);
    });
  }

  function confirmDelete(g: GroupOut) {
    if (!confirm(t("confirm_delete", { name: g.name }))) return;
    setBusy(g.id);
    startTransition(async () => {
      const res = await deleteGroup(g.id);
      if (res.ok) {
        setGroups((prev) => prev.filter((x) => x.id !== g.id));
      }
      setBusy(null);
    });
  }

  if (groups.length === 0) {
    return (
      <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
        {t("empty_state")}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 text-sm font-medium">
          {t("active_section")} ({active.length})
        </h2>
        {active.length === 0 ? (
          <p className="text-muted-foreground text-xs italic">{t("no_active")}</p>
        ) : (
          <ul className="space-y-2">
            {active.map((g) => (
              <GroupRow
                key={g.id}
                group={g}
                editing={editingId === g.id}
                draft={draft}
                busy={busy === g.id}
                onStartEdit={() => startEdit(g)}
                onDraftChange={setDraft}
                onCommit={() => commitRename(g.id)}
                onCancel={cancelEdit}
                onArchive={() => toggleArchive(g)}
                onDelete={() => confirmDelete(g)}
              />
            ))}
          </ul>
        )}
      </section>

      {archived.length > 0 && (
        <section>
          <h2 className="text-muted-foreground mb-2 text-sm font-medium">
            {t("archived_section")} ({archived.length})
          </h2>
          <ul className="space-y-2">
            {archived.map((g) => (
              <GroupRow
                key={g.id}
                group={g}
                editing={false}
                draft=""
                busy={busy === g.id}
                onStartEdit={() => {}}
                onDraftChange={() => {}}
                onCommit={() => {}}
                onCancel={() => {}}
                onArchive={() => toggleArchive(g)}
                onDelete={() => confirmDelete(g)}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function GroupRow({
  group,
  editing,
  draft,
  busy,
  onStartEdit,
  onDraftChange,
  onCommit,
  onCancel,
  onArchive,
  onDelete,
}: {
  group: GroupOut;
  editing: boolean;
  draft: string;
  busy: boolean;
  onStartEdit: () => void;
  onDraftChange: (s: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("Materials");
  const Icon = KIND_ICON[group.kind] ?? Bookmark;

  return (
    <li
      className={cn(
        "border-border flex items-center gap-2 rounded-md border px-3 py-2",
        group.archived ? "opacity-60" : "",
        busy ? "pointer-events-none opacity-50" : "",
      )}
    >
      <Icon className="text-muted-foreground h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCommit();
              if (e.key === "Escape") onCancel();
            }}
            autoFocus
            maxLength={200}
            className="border-input bg-background focus:ring-ring w-full rounded border px-2 py-1 text-sm outline-none focus:ring-1"
          />
        ) : (
          <button
            onClick={onStartEdit}
            disabled={group.archived}
            className="group block w-full text-left"
          >
            <span className="text-sm font-medium group-hover:underline group-hover:underline-offset-4 group-disabled:no-underline">
              {group.name}
            </span>
            {group.source_book_hint && (
              <span className="text-muted-foreground ml-2 text-xs">· {group.source_book_hint}</span>
            )}
          </button>
        )}
        <span className="text-muted-foreground block text-xs">
          {t("items_count", { count: group.item_count })} · {t(`kind_${group.kind}`)}
        </span>
      </div>

      {editing ? (
        <>
          <Button variant="ghost" size="icon-sm" onClick={onCommit} aria-label={t("save")}>
            <Check className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onCancel} aria-label={t("cancel")}>
            <X className="h-4 w-4" />
          </Button>
        </>
      ) : (
        <>
          {!group.archived && (
            <Button variant="ghost" size="icon-sm" onClick={onStartEdit} aria-label={t("rename")}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onArchive}
            aria-label={group.archived ? t("restore") : t("archive")}
          >
            {group.archived ? (
              <ArchiveRestore className="h-3.5 w-3.5" />
            ) : (
              <Archive className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onDelete}
            className="hover:text-destructive"
            aria-label={t("delete")}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </>
      )}
    </li>
  );
}
