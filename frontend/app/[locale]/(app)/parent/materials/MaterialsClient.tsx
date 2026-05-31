"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Archive,
  ArchiveRestore,
  BookOpen,
  Bookmark,
  ChevronDown,
  ChevronRight,
  Eye,
  Inbox,
  Loader2,
  MessageSquare,
  Plus,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GroupOut } from "@/lib/backend";
import { archiveGroup, deleteGroup, startSessionFromGroupAction } from "./actions";
import { Link } from "@/i18n/routing";
import { useKindLabel } from "./MaterialPickersClient";
import { IngestDrawerClient } from "@/app/[locale]/(app)/chat/[sessionId]/IngestDrawerClient";

const KIND_ICON: Record<string, typeof BookOpen> = {
  textbook_book: BookOpen,
  textbook_unit: Sparkles,
  textbook_lesson: Zap,
  personal_collection: Bookmark,
  quick_practice: Zap,
  review_set: Bookmark,
};

interface Props {
  groups: GroupOut[];
}

interface GroupNode {
  group: GroupOut;
  children: GroupNode[];
}

export function MaterialsClient({ groups: initialGroups }: Props) {
  const t = useTranslations("Materials");
  const kindLabel = useKindLabel();
  const router = useRouter();
  const [groups, setGroups] = useState<GroupOut[]>(initialGroups);
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  // Smart Ingest Dialog State
  const [isIngestOpen, setIsIngestOpen] = useState(false);

  // Set initial state on list updates
  useEffect(() => {
    const timer = setTimeout(() => {
      setGroups(initialGroups);
    }, 0);
    return () => clearTimeout(timer);
  }, [initialGroups]);

  // Recursively build textbook trees
  const activeTree = useMemo(() => {
    const active = groups.filter((g) => !g.archived);
    const map = new Map<string, GroupNode>();
    const roots: GroupNode[] = [];

    active.forEach((g) => {
      map.set(g.id, { group: g, children: [] });
    });

    active.forEach((g) => {
      const node = map.get(g.id)!;
      if (g.parent_id && map.has(g.parent_id)) {
        map.get(g.parent_id)!.children.push(node);
      } else {
        roots.push(node);
      }
    });

    return roots;
  }, [groups]);

  // Recursively compute descendant counts for every group
  const descendantCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const active = groups.filter((g) => !g.archived);
    const childrenMap = new Map<string, string[]>();
    const directCounts = new Map<string, number>();

    active.forEach((g) => {
      directCounts.set(g.id, g.item_count || 0);
      if (g.parent_id) {
        const list = childrenMap.get(g.parent_id) || [];
        list.push(g.id);
        childrenMap.set(g.parent_id, list);
      }
    });

    function getRecursiveCount(id: string, visited: Set<string> = new Set()): number {
      if (counts.has(id)) return counts.get(id)!;
      if (visited.has(id)) {
        console.warn("Circular reference detected in getRecursiveCount for group:", id);
        return 0;
      }
      visited.add(id);
      let sum = directCounts.get(id) || 0;
      const children = childrenMap.get(id) || [];
      children.forEach((childId) => {
        sum += getRecursiveCount(childId, new Set(visited));
      });
      counts.set(id, sum);
      return sum;
    }

    active.forEach((g) => {
      getRecursiveCount(g.id);
    });

    return counts;
  }, [groups]);

  // Canonical textbook trees vs. un-organized capture bags (the latter go to the
  // organize workbench). Splitting them makes the tag tree actually visible.
  const canonicalRoots = useMemo(
    () => activeTree.filter((n) => n.group.kind !== "quick_practice"),
    [activeTree],
  );
  const captureRoots = useMemo(
    () => activeTree.filter((n) => n.group.kind === "quick_practice" && n.group.item_count > 0),
    [activeTree],
  );

  const archivedGroups = useMemo(() => {
    return groups.filter((g) => g.archived && g.kind !== "quick_practice");
  }, [groups]);

  function handleOpenChange(open: boolean) {
    setIsIngestOpen(open);
  }

  // Trigger fast chat session
  function handleStartSession(groupId: string) {
    const totalCount = descendantCounts.get(groupId) || 0;
    if (totalCount > 100) {
      const ok = confirm(
        `当前选择的教材层级包含词句较多（共 ${totalCount} 个）。\n为了保证最佳对话练习效果，AI 老师将智能优先挑选您还未掌握的词句（最多 100 个）进行重点操练。\n建议您也可以选择具体单元或课次进行针对性练习。\n\n是否继续？`,
      );
      if (!ok) return;
    }
    setBusy(groupId);
    startTransition(async () => {
      const res = await startSessionFromGroupAction(groupId);
      setBusy(null);
      if (res.ok) {
        router.push(`/chat/${res.sessionId}`);
      } else {
        alert(`开始练习失败: ${res.error}`);
      }
    });
  }

  function handleToggleArchive(g: GroupOut) {
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

  return (
    <div className="space-y-6">
      {/* Top Banner with Action trigger */}
      <div className="relative flex flex-col items-start justify-between gap-4 overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 to-indigo-950 p-6 text-white shadow-lg sm:flex-row sm:items-center">
        {/* Subtle decorative background bubbles */}
        <div className="pointer-events-none absolute top-0 right-0 h-44 w-44 rounded-full bg-indigo-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-10 left-10 h-24 w-24 rounded-full bg-pink-500/10 blur-2xl" />

        <div className="relative z-10 space-y-1">
          <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-wide">
            <Sparkles className="h-5 w-5 animate-pulse text-indigo-400" />
            三位一体智能录入
          </h2>
          <p className="max-w-md text-xs text-slate-300">
            拍照、语音或手动输入，AI 识别出单词、短语和句型；之后在「整理素材」里一键归位成教材。
          </p>
        </div>

        <Button
          onClick={() => {
            handleOpenChange(true);
          }}
          className="group relative z-10 shrink-0 border border-slate-200 bg-white font-semibold text-slate-950 shadow-md hover:bg-slate-100"
          size="sm"
        >
          <Plus className="mr-1.5 h-4 w-4 text-indigo-600 transition-transform duration-200 group-hover:rotate-90" />
          智能录入新教材
        </Button>
      </div>

      {/* Un-organized capture bags → go to the organize workbench */}
      {captureRoots.length > 0 && (
        <section className="space-y-3 rounded-2xl border border-amber-300/60 bg-amber-50/40 p-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-sm font-bold text-amber-700">
              <Inbox className="h-4 w-4" />
              待整理采集（{captureRoots.length} 袋）
            </h3>
            <Link
              href="/parent/organize"
              className="text-sm font-medium text-amber-700 transition hover:text-amber-900"
            >
              去整理 →
            </Link>
          </div>
          <div className="flex flex-wrap gap-2">
            {captureRoots.map((n) => (
              <span
                key={n.group.id}
                className="border-border bg-background inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs"
              >
                {n.group.name}
                <span className="text-muted-foreground">{n.group.item_count} 词</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Canonical textbook tag tree */}
      <section className="space-y-3">
        <div className="flex items-center justify-between border-b pb-2">
          <h3 className="text-foreground flex items-center gap-1.5 text-sm font-bold">
            <BookOpen className="h-4 w-4 text-slate-500" />
            教材结构
          </h3>
          <span className="text-muted-foreground text-xs">{canonicalRoots.length} 本教材</span>
        </div>

        {canonicalRoots.length === 0 ? (
          <div className="text-muted-foreground bg-card/20 rounded-2xl border border-dashed p-10 text-center text-sm shadow-inner">
            <Bookmark className="mx-auto mb-2 h-8 w-8 text-slate-300" />
            <p className="font-semibold text-slate-400">还没有成形的教材</p>
            <p className="mt-1 text-xs text-slate-400">
              先「智能录入」采集素材，再去「整理素材」把它们归位成教材标签树。
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {canonicalRoots.map((node) => (
              <TreeViewNode
                key={node.group.id}
                node={node}
                depth={0}
                busy={busy}
                kindLabel={kindLabel}
                descendantCounts={descendantCounts}
                onStartSession={handleStartSession}
                onArchive={handleToggleArchive}
                onDelete={confirmDelete}
              />
            ))}
          </div>
        )}
      </section>

      {/* Archived Section */}
      {archivedGroups.length > 0 && (
        <section className="space-y-3 border-t pt-4">
          <h3 className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold">
            <Archive className="h-3.5 w-3.5" />
            已归档素材 ({archivedGroups.length})
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {archivedGroups.map((g) => (
              <div
                key={g.id}
                className="bg-card/40 flex items-center justify-between rounded-xl border p-3 opacity-60 transition-opacity hover:opacity-90"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-foreground truncate text-sm font-semibold">{g.name}</p>
                  <p className="text-muted-foreground text-[10px]">
                    {g.item_count} 个学习点 · {kindLabel(g.kind)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleToggleArchive(g)}
                    disabled={busy === g.id}
                    title="恢复"
                  >
                    <ArchiveRestore className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => confirmDelete(g)}
                    disabled={busy === g.id}
                    className="hover:text-destructive text-muted-foreground"
                    title="删除"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Ingestion Drawer Dialog Overlay */}
      <IngestDrawerClient
        open={isIngestOpen}
        initialTrigger={null}
        onOpenChange={handleOpenChange}
        onGroupApplied={(group) => {
          setGroups((prev) => [group, ...prev]);
        }}
      />
    </div>
  );
}

// Beautiful recursive tree rendering component
function TreeViewNode({
  node,
  depth,
  busy,
  kindLabel,
  descendantCounts,
  onStartSession,
  onArchive,
  onDelete,
}: {
  node: GroupNode;
  depth: number;
  busy: string | null;
  kindLabel: (kind: string) => string;
  descendantCounts: Map<string, number>;
  onStartSession: (id: string) => void;
  onArchive: (g: GroupOut) => void;
  onDelete: (g: GroupOut) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { group, children } = node;

  const Icon = KIND_ICON[group.kind] ?? Bookmark;
  const isBusy = busy === group.id;

  return (
    <div className="space-y-2">
      {/* Container card */}
      <div
        className={cn(
          "group flex flex-col gap-3 rounded-xl border p-4 transition-all duration-200 sm:flex-row sm:items-center sm:justify-between",
          depth === 0
            ? "bg-card border-slate-200/80 shadow-sm hover:border-slate-300"
            : depth === 1
              ? "bg-card/75 relative ml-3 border-slate-100 hover:border-indigo-100 hover:bg-indigo-50/10 sm:ml-6"
              : "bg-card/40 relative ml-6 border-dashed border-slate-200 hover:border-indigo-200 hover:bg-indigo-50/20 sm:ml-12",
          isBusy ? "pointer-events-none opacity-50" : "",
        )}
      >
        {/* Visual guide line */}
        {depth > 0 && (
          <div
            className="pointer-events-none absolute top-1/2 -left-3 h-[2px] w-3 bg-slate-200"
            style={{ transform: "translateY(-50%)" }}
          />
        )}
        {depth > 0 && (
          <div
            className="pointer-events-none absolute top-0 -left-3 h-full w-[2px] bg-slate-200"
            style={{ height: children.length > 0 && expanded ? "50%" : "100%" }}
          />
        )}

        <div className="flex min-w-0 items-center gap-3">
          {/* Collapse/Expand indicator */}
          {children.length > 0 ? (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-muted-foreground hover:text-foreground hover:bg-muted shrink-0 rounded p-0.5"
            >
              {expanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          ) : (
            <div className="w-5 shrink-0" />
          )}

          {/* Type Badge icon */}
          <div
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border shadow-sm",
              depth === 0
                ? "border-slate-200 bg-slate-100 text-slate-800"
                : depth === 1
                  ? "border-indigo-100 bg-indigo-50 text-indigo-800"
                  : "border-emerald-100 bg-emerald-50 text-emerald-800",
            )}
          >
            <Icon className="h-4 w-4" />
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/parent/materials/${group.id}`}>
                <span className="text-foreground cursor-pointer truncate text-sm leading-tight font-bold transition-colors hover:text-indigo-600 hover:underline">
                  {group.name}
                </span>
              </Link>
              <span className="py-0.2 shrink-0 rounded bg-slate-100 px-1 text-[10px] font-semibold text-slate-500">
                {kindLabel(group.kind)}
              </span>
            </div>
            <span className="text-muted-foreground mt-0.5 block text-[10px]">
              {(() => {
                const recursiveCount = descendantCounts.get(group.id) || group.item_count;
                if (group.item_count === 0 && recursiveCount > 0) {
                  return (
                    <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                      包含 {recursiveCount} 个词句
                    </span>
                  );
                } else if (recursiveCount > group.item_count) {
                  return (
                    <span>
                      {group.item_count} 个词句（共 {recursiveCount} 个）
                    </span>
                  );
                } else {
                  return <span>{group.item_count} 个词句</span>;
                }
              })()}
              {group.source_book_hint && ` · ${group.source_book_hint}`}
            </span>
          </div>
        </div>

        {/* Action button triggers */}
        <div className="flex shrink-0 flex-wrap items-center gap-1 sm:ml-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onStartSession(group.id)}
            disabled={isBusy}
            className="flex h-8 shrink-0 items-center border-indigo-100 text-xs font-semibold text-indigo-700 shadow-sm hover:bg-indigo-50 hover:text-indigo-800"
          >
            {isBusy ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <MessageSquare className="mr-1 h-3.5 w-3.5 text-indigo-500" />
            )}
            对话练习
          </Button>

          {/* View detailed material */}
          <Link href={`/parent/materials/${group.id}`}>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground shrink-0"
              title="查看详情"
            >
              <Eye className="h-3.5 w-3.5" />
            </Button>
          </Link>

          {/* Archive material */}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onArchive(group)}
            disabled={isBusy}
            className="text-muted-foreground hover:text-foreground shrink-0"
            title="归档"
          >
            <Archive className="h-3.5 w-3.5" />
          </Button>

          {/* Delete material */}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onDelete(group)}
            disabled={isBusy}
            className="hover:text-destructive text-muted-foreground shrink-0"
            title="彻底删除"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Recurse children */}
      {children.length > 0 && expanded && (
        <div className="space-y-2">
          {children.map((child) => (
            <TreeViewNode
              key={child.group.id}
              node={child}
              depth={depth + 1}
              busy={busy}
              kindLabel={kindLabel}
              descendantCounts={descendantCounts}
              onStartSession={onStartSession}
              onArchive={onArchive}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
