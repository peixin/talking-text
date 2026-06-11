"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  Archive,
  ArchiveRestore,
  BookOpen,
  Bookmark,
  ChevronDown,
  ChevronRight,
  Eye,
  GitFork,
  Inbox,
  Link2,
  Loader2,
  MessageSquare,
  Plus,
  Share2,
  Sparkles,
  Trash2,
  Unlink,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SCOPE_SOFT_CAP } from "@/lib/constants";
import type { GroupOut, SubscriptionOut } from "@/lib/backend";
import {
  archiveGroup,
  createShareLinkAction,
  deleteGroup,
  forkSubscriptionAction,
  startSessionFromGroupAction,
  unsubscribeAction,
} from "./actions";
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
  subscriptions: SubscriptionOut[];
}

interface GroupNode {
  group: GroupOut;
  children: GroupNode[];
}

export function MaterialsClient({ groups: initialGroups, subscriptions }: Props) {
  const t = useTranslations("Materials");
  const kindLabel = useKindLabel();
  const router = useRouter();
  const locale = useLocale();
  const [groups, setGroups] = useState<GroupOut[]>(initialGroups);
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [shareCodeDraft, setShareCodeDraft] = useState("");

  // subscription lookup by source group id; tombstones have no source group.
  const subBySourceId = useMemo(
    () =>
      new Map(subscriptions.filter((s) => s.source_group_id).map((s) => [s.source_group_id!, s])),
    [subscriptions],
  );
  const tombstones = useMemo(
    () => subscriptions.filter((s) => !s.source_group_id),
    [subscriptions],
  );

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
    if (totalCount > SCOPE_SOFT_CAP) {
      const ok = confirm(t("confirm_large_scope", { count: totalCount, cap: SCOPE_SOFT_CAP }));
      if (!ok) return;
    }
    setBusy(groupId);
    startTransition(async () => {
      const res = await startSessionFromGroupAction(groupId);
      setBusy(null);
      if (res.ok) {
        router.push(`/chat/${res.sessionId}`);
      } else {
        alert(t("start_session_failed", { error: res.error }));
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

  // ── Material sharing ────────────────────────────────────────────────────────

  function handleShare(g: GroupOut) {
    setBusy(g.id);
    startTransition(async () => {
      const res = await createShareLinkAction(g.id);
      setBusy(null);
      if (!res.ok) {
        alert(t("share_failed", { error: res.error }));
        return;
      }
      const url = `${window.location.origin}/${locale}/parent/materials/share/${res.code}`;
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        // clipboard may be unavailable (non-HTTPS); the alert still shows the link
      }
      alert(t("share_link_copied", { url, code: res.code }));
    });
  }

  function handleFork(g: GroupOut, sub: SubscriptionOut) {
    if (!confirm(t("fork_confirm", { name: g.name }))) return;
    setBusy(g.id);
    startTransition(async () => {
      const res = await forkSubscriptionAction(sub.id);
      setBusy(null);
      if (res.ok) {
        router.refresh();
      } else {
        alert(t("fork_failed", { error: res.error }));
      }
    });
  }

  function handleUnsubscribe(name: string, sub: SubscriptionOut) {
    if (!confirm(t("unsubscribe_confirm", { name }))) return;
    setBusy(sub.id);
    startTransition(async () => {
      const res = await unsubscribeAction(sub.id);
      setBusy(null);
      if (res.ok) {
        setGroups((prev) => prev.filter((x) => x.id !== sub.source_group_id));
        router.refresh();
      }
    });
  }

  function handleOpenSharedCode() {
    // Accept either a bare code or a full pasted URL (code = last path segment).
    const raw = shareCodeDraft.trim();
    if (!raw) return;
    const code = (raw.split("/").pop() || raw).trim().toUpperCase();
    router.push(`/${locale}/parent/materials/share/${encodeURIComponent(code)}`);
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
            {t("banner_title")}
          </h2>
          <p className="max-w-md text-xs text-slate-300">{t("banner_subtitle")}</p>
        </div>

        <Button
          onClick={() => {
            handleOpenChange(true);
          }}
          className="group relative z-10 shrink-0 border border-slate-200 bg-white font-semibold text-slate-950 shadow-md hover:bg-slate-100"
          size="sm"
        >
          <Plus className="mr-1.5 h-4 w-4 text-indigo-600 transition-transform duration-200 group-hover:rotate-90" />
          {t("banner_button")}
        </Button>
      </div>

      {/* Add a book another family shared (paste link or code) */}
      <div className="border-border bg-card/40 flex flex-col gap-2 rounded-xl border border-dashed p-3 sm:flex-row sm:items-center">
        <span className="text-muted-foreground flex shrink-0 items-center gap-1.5 text-xs font-medium">
          <Link2 className="h-3.5 w-3.5" />
          {t("add_shared_title")}
        </span>
        <input
          value={shareCodeDraft}
          onChange={(e) => setShareCodeDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleOpenSharedCode();
          }}
          placeholder={t("add_shared_placeholder")}
          className="border-border bg-background focus:ring-ring min-w-0 flex-1 rounded-md border px-3 py-1.5 text-sm focus:ring-1 focus:outline-none"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={handleOpenSharedCode}
          disabled={!shareCodeDraft.trim()}
          className="shrink-0"
        >
          {t("add_shared_button")}
        </Button>
      </div>

      {/* Un-organized capture bags → practice straight away, or organize later */}
      {captureRoots.length > 0 && (
        <section className="space-y-3 rounded-2xl border border-amber-300/60 bg-amber-50/40 p-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-sm font-bold text-amber-700">
              <Inbox className="h-4 w-4" />
              {t("capture_section_title", { count: captureRoots.length })}
            </h3>
            <Link
              href="/parent/organize"
              className="text-sm font-medium text-amber-700 transition hover:text-amber-900"
            >
              {t("capture_organize_link")}
            </Link>
          </div>
          <p className="text-xs text-amber-700/70">{t("capture_section_hint")}</p>
          <div className="flex flex-wrap gap-2">
            {captureRoots.map((n) => {
              const isBusy = busy === n.group.id;
              return (
                <div
                  key={n.group.id}
                  className="border-border bg-background inline-flex items-center gap-2 rounded-full border py-1 pr-1 pl-3 text-xs"
                >
                  <Link
                    href={`/parent/materials/${n.group.id}`}
                    className="font-medium transition hover:text-amber-700"
                    title={t("capture_bag_tooltip")}
                  >
                    {n.group.name}
                  </Link>
                  <span className="text-muted-foreground">
                    {t("capture_word_count", { count: n.group.item_count })}
                  </span>
                  <Button
                    size="sm"
                    onClick={() => handleStartSession(n.group.id)}
                    disabled={isBusy}
                    className="h-6 rounded-full bg-amber-500 px-2.5 text-[11px] font-semibold text-white hover:bg-amber-600"
                  >
                    {isBusy ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <>
                        <MessageSquare className="mr-1 h-3 w-3" />
                        {t("practice")}
                      </>
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Canonical textbook tag tree */}
      <section className="space-y-3">
        <div className="flex items-center justify-between border-b pb-2">
          <h3 className="text-foreground flex items-center gap-1.5 text-sm font-bold">
            <BookOpen className="h-4 w-4 text-slate-500" />
            {t("tree_section_title")}
          </h3>
          <span className="text-muted-foreground text-xs">
            {t("tree_books_count", { count: canonicalRoots.length })}
          </span>
        </div>

        {canonicalRoots.length === 0 ? (
          <div className="text-muted-foreground bg-card/20 rounded-2xl border border-dashed p-10 text-center text-sm shadow-inner">
            <Bookmark className="mx-auto mb-2 h-8 w-8 text-slate-300" />
            <p className="font-semibold text-slate-400">{t("tree_empty_title")}</p>
            <p className="mt-1 text-xs text-slate-400">{t("tree_empty_hint")}</p>
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
                subscription={subBySourceId.get(node.group.id)}
                onShare={handleShare}
                onFork={handleFork}
                onUnsubscribe={handleUnsubscribe}
              />
            ))}
          </div>
        )}
      </section>

      {/* Dead subscriptions — the source owner deleted the book (tombstones) */}
      {tombstones.length > 0 && (
        <section className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-900/40">
          {tombstones.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 text-xs">
              <span className="text-muted-foreground">
                {t("tombstone_text", {
                  date: new Date(s.subscribed_at).toLocaleDateString(),
                })}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy === s.id}
                onClick={() => {
                  setBusy(s.id);
                  startTransition(async () => {
                    await unsubscribeAction(s.id);
                    setBusy(null);
                    router.refresh();
                  });
                }}
                className="text-muted-foreground hover:text-destructive h-7 shrink-0 text-xs"
              >
                {t("tombstone_remove")}
              </Button>
            </div>
          ))}
        </section>
      )}

      {/* Archived Section */}
      {archivedGroups.length > 0 && (
        <section className="space-y-3 border-t pt-4">
          <h3 className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold">
            <Archive className="h-3.5 w-3.5" />
            {t("archived_section_title", { count: archivedGroups.length })}
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
                    {t("items_count", { count: g.item_count })} · {kindLabel(g.kind)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleToggleArchive(g)}
                    disabled={busy === g.id}
                    title={t("restore")}
                  >
                    <ArchiveRestore className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => confirmDelete(g)}
                    disabled={busy === g.id}
                    className="hover:text-destructive text-muted-foreground"
                    title={t("delete")}
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
  subscription,
  onShare,
  onFork,
  onUnsubscribe,
}: {
  node: GroupNode;
  depth: number;
  busy: string | null;
  kindLabel: (kind: string) => string;
  descendantCounts: Map<string, number>;
  onStartSession: (id: string) => void;
  onArchive: (g: GroupOut) => void;
  onDelete: (g: GroupOut) => void;
  /** Present only on the root node of a subscribed (cross-account) tree. */
  subscription?: SubscriptionOut;
  onShare?: (g: GroupOut) => void;
  onFork?: (g: GroupOut, sub: SubscriptionOut) => void;
  onUnsubscribe?: (name: string, sub: SubscriptionOut) => void;
}) {
  const t = useTranslations("Materials");
  const [expanded, setExpanded] = useState(false);
  const { group, children } = node;

  const Icon = KIND_ICON[group.kind] ?? Bookmark;
  const isBusy = busy === group.id;
  const isSubscribed = group.subscribed === true;

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
              {isSubscribed && (
                <span className="shrink-0 rounded bg-sky-100 px-1 py-px text-[10px] font-semibold text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                  {t("subscribed_badge")}
                </span>
              )}
            </div>
            <span className="text-muted-foreground mt-0.5 block text-[10px]">
              {(() => {
                const recursiveCount = descendantCounts.get(group.id) || group.item_count;
                if (group.item_count === 0 && recursiveCount > 0) {
                  return (
                    <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                      {t("contains_items", { count: recursiveCount })}
                    </span>
                  );
                } else if (recursiveCount > group.item_count) {
                  return (
                    <span>
                      {t("items_with_total", { count: group.item_count, total: recursiveCount })}
                    </span>
                  );
                } else {
                  return <span>{t("items_only", { count: group.item_count })}</span>;
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
            {t("practice_chat")}
          </Button>

          {/* View detailed material */}
          <Link href={`/parent/materials/${group.id}`}>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground shrink-0"
              title={t("view_details")}
            >
              <Eye className="h-3.5 w-3.5" />
            </Button>
          </Link>

          {/* Owner-only: share (root) + archive + delete. Subscribed: fork + unsubscribe. */}
          {!isSubscribed && depth === 0 && group.parent_id === null && onShare && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onShare(group)}
              disabled={isBusy}
              className="text-muted-foreground shrink-0 hover:text-sky-600"
              title={t("share")}
            >
              <Share2 className="h-3.5 w-3.5" />
            </Button>
          )}

          {!isSubscribed && (
            <>
              {/* Archive material */}
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onArchive(group)}
                disabled={isBusy}
                className="text-muted-foreground hover:text-foreground shrink-0"
                title={t("archive")}
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
                title={t("delete_permanently")}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}

          {isSubscribed && subscription && (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onFork?.(group, subscription)}
                disabled={isBusy}
                className="text-muted-foreground shrink-0 hover:text-indigo-600"
                title={t("fork")}
              >
                <GitFork className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onUnsubscribe?.(group.name, subscription)}
                disabled={isBusy}
                className="hover:text-destructive text-muted-foreground shrink-0"
                title={t("unsubscribe")}
              >
                <Unlink className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
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
