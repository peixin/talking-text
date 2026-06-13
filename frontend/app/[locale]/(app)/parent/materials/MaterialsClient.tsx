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
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/EmptyState";
import { Panel } from "@/components/Panel";
import { cn } from "@/lib/utils";
import { SCOPE_SOFT_CAP } from "@/lib/constants";
import { toast } from "sonner";
import type { GroupOut, LearnerOut, SubscriptionOut } from "@/lib/backend";
import {
  archiveGroup,
  assignLearnerToGroup,
  createShareLinkAction,
  deleteGroup,
  forkSubscriptionAction,
  startSessionFromGroupAction,
  unassignLearnerFromGroup,
  unsubscribeAction,
} from "./actions";
import { Link } from "@/i18n/routing";
import { useKindLabel } from "./MaterialPickersClient";
import { IngestDrawerClient } from "@/app/[locale]/(app)/chat/[sessionId]/IngestDrawerClient";

type LearnerRef = { id: string; name: string };

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
  allLearners?: LearnerOut[];
  /** groupId → list of assigned learners (only root groups with ≥1 learner) */
  rootBookLearners?: Record<string, LearnerRef[]>;
}

interface GroupNode {
  group: GroupOut;
  children: GroupNode[];
}

export function MaterialsClient({ groups: initialGroups, subscriptions, allLearners = [], rootBookLearners = {} }: Props) {
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
        toast.error(t("start_session_failed", { error: res.error }));
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
        toast.error(t("share_failed", { error: res.error }));
        return;
      }
      const url = `${window.location.origin}/${locale}/parent/materials/share/${res.code}`;
      try {
        await navigator.clipboard.writeText(url);
        toast.success(t("share_copied_title"), { description: t("share_code_hint", { code: res.code }) });
      } catch {
        // clipboard unavailable (non-HTTPS) — show the URL so user can copy manually
        toast.info(t("share_fallback_title"), { description: `${url}` });
      }
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
        toast.error(t("fork_failed", { error: res.error }));
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

  // Quick-access root books: root-level, non-archived groups with ≥1 learner assigned
  const quickBooks = useMemo(() => {
    return groups.filter(
      (g) => !g.archived && g.parent_id === null && g.kind !== "quick_practice" && rootBookLearners[g.id],
    );
  }, [groups, rootBookLearners]);

  return (
    <div className="space-y-6">
      {/* Quick Book Access — root books with learners assigned */}
      {quickBooks.length > 0 && (
        <section className="space-y-2">
          <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold">
            <BookOpen className="h-3.5 w-3.5" />
            {t("quick_access")}
          </p>
          <div className="flex flex-wrap gap-2">
            {quickBooks.map((g) => {
              const learnerRefs = rootBookLearners[g.id] ?? [];
              return (
                <Link
                  key={g.id}
                  href={`/parent/materials/${g.id}`}
                  className="border-border bg-card hover:border-primary hover:bg-primary/5 hover:text-primary group inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition"
                >
                  <BookOpen className="text-primary h-3.5 w-3.5 shrink-0" />
                  <span className="font-semibold">{g.name}</span>
                  {learnerRefs.length > 0 && (
                    <span className="text-muted-foreground border-border flex items-center gap-1 border-l pl-2">
                      {learnerRefs.map((lr) => (
                        <span
                          key={lr.id}
                          className="bg-primary/10 text-primary rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                        >
                          {lr.name}
                        </span>
                      ))}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </section>
      )}
      {/* Top Banner with Action trigger */}
      <div className="from-foreground to-primary text-primary-foreground relative flex flex-col items-start justify-between gap-4 overflow-hidden rounded-2xl bg-gradient-to-r p-6 shadow-lg sm:flex-row sm:items-center">
        {/* Subtle decorative background bubbles */}
        <div className="bg-primary/10 pointer-events-none absolute top-0 right-0 h-44 w-44 rounded-full blur-3xl" />
        <div className="bg-primary/10 pointer-events-none absolute -bottom-10 left-10 h-24 w-24 rounded-full blur-2xl" />

        <div className="relative z-10 space-y-1">
          <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-wide">
            <Sparkles className="text-primary/60 h-5 w-5 animate-pulse" />
            {t("banner_title")}
          </h2>
          <p className="text-primary-foreground/70 max-w-md text-xs">{t("banner_subtitle")}</p>
        </div>

        <Button
          onClick={() => {
            handleOpenChange(true);
          }}
          className="group border-border bg-card text-foreground hover:bg-muted relative z-10 shrink-0 border font-semibold shadow-md"
          size="sm"
        >
          <Plus className="text-primary mr-1.5 h-4 w-4 transition-transform duration-200 group-hover:rotate-90" />
          {t("banner_button")}
        </Button>
      </div>

      {/* Add a book another family shared (paste link or code) */}
      <Panel className="bg-card/40 flex flex-col gap-2 border-dashed p-3 sm:flex-row sm:items-center">
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
      </Panel>

      {/* Un-organized capture bags → practice straight away, or organize later */}
      {captureRoots.length > 0 && (
        <section className="border-warning/40 bg-warning/10 space-y-3 rounded-2xl border p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-warning flex items-center gap-1.5 text-sm font-bold">
              <Inbox className="h-4 w-4" />
              {t("capture_section_title", { count: captureRoots.length })}
            </h3>
            <Link
              href="/parent/organize"
              className="text-warning hover:text-warning/80 text-sm font-medium transition"
            >
              {t("capture_organize_link")}
            </Link>
          </div>
          <p className="text-warning/70 text-xs">{t("capture_section_hint")}</p>
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
                    className="hover:text-warning font-medium transition"
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
                    className="bg-warning hover:bg-warning/90 h-6 rounded-full px-2.5 text-[11px] font-semibold text-white"
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
            <BookOpen className="text-muted-foreground h-4 w-4" />
            {t("tree_section_title")}
          </h3>
          <span className="text-muted-foreground text-xs">
            {t("tree_books_count", { count: canonicalRoots.length })}
          </span>
        </div>

        {canonicalRoots.length === 0 ? (
          <EmptyState className="bg-card/20 rounded-2xl p-10 shadow-inner">
            <Bookmark className="text-muted-foreground/50 mx-auto mb-2 h-8 w-8" />
            <span className="text-muted-foreground/70 block font-semibold">
              {t("tree_empty_title")}
            </span>
            <span className="text-muted-foreground/70 mt-1 block text-xs">
              {t("tree_empty_hint")}
            </span>
          </EmptyState>
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
                learnerRefs={rootBookLearners[node.group.id]}
                allLearners={allLearners}
              />
            ))}
          </div>
        )}
      </section>

      {/* Dead subscriptions — the source owner deleted the book (tombstones) */}
      {tombstones.length > 0 && (
        <section className="border-border bg-muted/50 space-y-2 rounded-xl border p-3">
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
  learnerRefs,
  allLearners = [],
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
  /** Learners currently assigned (only passed for root/depth=0 nodes) */
  learnerRefs?: LearnerRef[];
  /** All learners — used to render assign buttons for unassigned ones */
  allLearners?: LearnerOut[];
}) {
  const t = useTranslations("Materials");
  const [, startTransitionNode] = useTransition();
  const [expanded, setExpanded] = useState(false);
  // Optimistic local assignment state for instant UI feedback
  const [assignedIds, setAssignedIds] = useState<Set<string>>(
    () => new Set((learnerRefs ?? []).map((l) => l.id)),
  );
  const { group, children } = node;

  const Icon = KIND_ICON[group.kind] ?? Bookmark;
  const isBusy = busy === group.id;
  const isSubscribed = group.subscribed === true;

  function handleAssign(learnerId: string) {
    setAssignedIds((prev) => new Set([...prev, learnerId]));
    startTransitionNode(async () => {
      const res = await assignLearnerToGroup(group.id, learnerId);
      if (!res.ok) {
        setAssignedIds((prev) => { const next = new Set(prev); next.delete(learnerId); return next; });
        toast.error(t("assign_failed", { error: res.error }));
      }
    });
  }

  function handleUnassign(learnerId: string) {
    setAssignedIds((prev) => { const next = new Set(prev); next.delete(learnerId); return next; });
    startTransitionNode(async () => {
      const res = await unassignLearnerFromGroup(group.id, learnerId);
      if (!res.ok) {
        setAssignedIds((prev) => new Set([...prev, learnerId]));
        toast.error(t("unassign_failed", { error: res.error }));
      }
    });
  }

  return (
    <div className="space-y-2">
      {/* Container card */}
      <Panel
        className={cn(
          "group flex flex-col gap-3 transition-all duration-200 sm:flex-row sm:items-center sm:justify-between",
          depth === 0
            ? "hover:border-input shadow-sm"
            : depth === 1
              ? "bg-card/75 hover:border-primary/20 hover:bg-primary/5 relative ml-3 sm:ml-6"
              : "bg-card/40 hover:border-primary/20 hover:bg-primary/5 relative ml-6 border-dashed sm:ml-12",
          isBusy ? "pointer-events-none opacity-50" : "",
        )}
      >
        {/* Visual guide line */}
        {depth > 0 && (
          <div
            className="bg-border pointer-events-none absolute top-1/2 -left-3 h-[2px] w-3"
            style={{ transform: "translateY(-50%)" }}
          />
        )}
        {depth > 0 && (
          <div
            className="bg-border pointer-events-none absolute top-0 -left-3 h-full w-[2px]"
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
                ? "border-border bg-muted text-foreground"
                : depth === 1
                  ? "border-primary/20 bg-primary/5 text-primary"
                  : "border-success/30 bg-success/10 text-success",
            )}
          >
            <Icon className="h-4 w-4" />
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/parent/materials/${group.id}`}>
                <span className="text-foreground hover:text-primary cursor-pointer truncate text-sm leading-tight font-bold transition-colors hover:underline">
                  {group.name}
                </span>
              </Link>
              <Badge
                variant="secondary"
                className="py-0.2 bg-muted text-muted-foreground h-auto shrink-0 rounded border-0 px-1 text-[10px] font-semibold"
              >
                {kindLabel(group.kind)}
              </Badge>
              {isSubscribed && (
                <Badge
                  variant="success"
                  className="h-auto shrink-0 rounded border-0 px-1 py-px text-[10px] font-semibold"
                >
                  {t("subscribed_badge")}
                </Badge>
              )}
              {/* Learner assign/unassign — only on root nodes */}
              {depth === 0 && allLearners.length > 0 && allLearners.map((l) => {
                const isAssigned = assignedIds.has(l.id);
                return isAssigned ? (
                  <button
                    key={l.id}
                    onClick={() => handleUnassign(l.id)}
                    title={`取消将此教材指定给 ${l.name}`}
                    className="bg-primary/10 text-primary hover:bg-destructive/10 hover:text-destructive group/lb inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold transition"
                  >
                    👤 {l.name}
                    <span className="opacity-0 group-hover/lb:opacity-100 transition">×</span>
                  </button>
                ) : (
                  <button
                    key={l.id}
                    onClick={() => handleAssign(l.id)}
                    title={`将此教材指定给 ${l.name}`}
                    className="text-muted-foreground/50 hover:bg-primary/10 hover:text-primary inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-[10px] transition"
                  >
                    + {l.name}
                  </button>
                );
              })}
            </div>
            <span className="text-muted-foreground mt-0.5 block text-[10px]">
              {(() => {
                const recursiveCount = descendantCounts.get(group.id) || group.item_count;
                if (group.item_count === 0 && recursiveCount > 0) {
                  return (
                    <span className="text-primary font-semibold">
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
            className="border-primary/20 text-primary hover:bg-primary/5 hover:text-primary flex h-8 shrink-0 items-center text-xs font-semibold shadow-sm"
          >
            {isBusy ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <MessageSquare className="text-primary mr-1 h-3.5 w-3.5" />
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
              className="text-muted-foreground hover:text-primary shrink-0"
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
                className="text-muted-foreground hover:text-primary shrink-0"
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
      </Panel>

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
