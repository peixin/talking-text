"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Archive,
  ArrowUpRight,
  BookOpen,
  Bookmark,
  ChevronDown,
  Edit3,
  FolderPlus,
  Loader2,
  MessageSquare,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Users,
  X,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/Panel";
import { Link } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import type { GroupDetailOut, GroupOut, ItemType } from "@/lib/backend";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { LEVEL_PRESETS } from "@/lib/constants";
import {
  startSessionFromGroupAction,
  updateGroup,
  deleteGroup,
  renameGroup,
  archiveGroup,
  createGroup,
} from "../actions";

interface Props {
  group: GroupDetailOut;
  allGroups: GroupOut[];
  learnerCount: number;
  readOnly?: boolean;
}

const KIND_ICON: Record<string, typeof BookOpen> = {
  textbook_book: BookOpen,
  textbook_unit: Sparkles,
  textbook_lesson: Zap,
  personal_collection: Bookmark,
  quick_practice: Zap,
  review_set: Bookmark,
};

// Maps a group kind to its Materials.* translation key.
const KIND_LABEL_KEY: Record<string, string> = {
  textbook_book: "kind_textbook_book",
  textbook_unit: "kind_textbook_unit",
  textbook_lesson: "kind_textbook_lesson",
  personal_collection: "kind_personal_collection",
  quick_practice: "kind_quick_practice",
  review_set: "kind_review_set",
};

function computePathLevels(currentGroupId: string, groups: GroupOut[]): string[] {
  const path: string[] = [];
  const visited = new Set<string>();
  let curr: GroupOut | undefined = groups.find((g) => g.id === currentGroupId);
  while (curr) {
    if (visited.has(curr.id)) {
      console.warn("Circular reference detected in computePathLevels for group:", curr.id);
      break;
    }
    visited.add(curr.id);
    path.unshift(curr.name);
    const pid: string | null = curr.parent_id;
    if (!pid) break;
    curr = groups.find((g) => g.id === pid);
  }
  return path;
}

export function GroupDetailClient({ group, allGroups, learnerCount, readOnly = false }: Props) {
  const t = useTranslations("Materials");
  const router = useRouter();

  // Stable primitive reference — avoids React Compiler treating `group` as a
  // coarse object dependency in useMemo hooks below.
  const groupId = group.id;

  // Core visual states
  const [groupName, setGroupName] = useState(group.name);
  const [groupsLocalState, setGroupsLocalState] = useState<GroupOut[]>(allGroups);

  // Sibling layout navigation visual highlight state
  const [highlightSubChapters, setHighlightSubChapters] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === "#sub-chapters-list") {
      // Defer setState to next tick — calling setState synchronously in an effect
      // body triggers cascading renders (react-hooks/set-state-in-effect).
      let offTimer: ReturnType<typeof setTimeout>;
      const onTimer = setTimeout(() => {
        setHighlightSubChapters(true);
        offTimer = setTimeout(() => setHighlightSubChapters(false), 1500);
      }, 0);
      return () => {
        clearTimeout(onTimer);
        clearTimeout(offTimer);
      };
    }
  }, []);

  // Compute hierarchy paths dynamically based on updated tree
  const initialLevels = useMemo(
    () => computePathLevels(group.id, groupsLocalState),
    [group.id, groupsLocalState],
  );
  const [levels, setLevels] = useState<string[]>(
    initialLevels.length > 0 ? initialLevels : [t("uncategorized_material")],
  );

  const initialLevelTitles = useMemo(() => {
    const pathNodes: GroupOut[] = [];
    const visited = new Set<string>();
    let curr: GroupOut | undefined = groupsLocalState.find((g) => g.id === group.id);
    while (curr) {
      if (visited.has(curr.id)) {
        console.warn("Circular reference detected in initialLevelTitles for group:", curr.id);
        break;
      }
      visited.add(curr.id);
      pathNodes.unshift(curr);
      const pid = curr.parent_id;
      if (!pid) break;
      curr = groupsLocalState.find((g) => g.id === pid);
    }
    return pathNodes.map(
      (node, idx) => node.level_title || LEVEL_PRESETS[idx] || t("level_n", { n: idx + 1 }),
    );
  }, [group.id, groupsLocalState, t]);

  const [levelTitles, setLevelTitles] = useState<string[]>(
    initialLevelTitles.length > 0 ? initialLevelTitles : [LEVEL_PRESETS[0]],
  );
  const [activeLevelTitlePopoverIdx, setActiveLevelTitlePopoverIdx] = useState<number | null>(null);

  // Breadcrumb path: the REAL ancestor chain (root → current). We deliberately stop at
  // the current node instead of diving into an arbitrary first-child branch — when a
  // node has multiple children there is no single "next" to show, so descent is
  // expressed by the depth indicator + the sub-chapter list, never faked into the path.
  const breadcrumbPath = useMemo(() => {
    const nodes: GroupOut[] = [];
    const visited = new Set<string>();
    let curr: GroupOut | undefined = groupsLocalState.find((g) => g.id === groupId);
    while (curr) {
      if (visited.has(curr.id)) break;
      visited.add(curr.id);
      nodes.unshift(curr);
      const pid: string | null = curr.parent_id;
      if (!pid) break;
      curr = groupsLocalState.find((g) => g.id === pid);
    }
    return nodes;
  }, [groupId, groupsLocalState]);

  // Full chain view: ancestors + current, then auto-extend DOWN the branch as long as
  // each level has exactly one child (rendered as real, clickable downstream crumbs).
  // Stop at the first branching level and surface its children via a popover — we never
  // pick an arbitrary branch. All data is already client-side (groupsLocalState), so
  // this is pure in-memory traversal: zero extra requests.
  const fullChain = useMemo(() => {
    const crumbs = [...breadcrumbPath];
    const currentIdx = crumbs.length - 1;
    const guard = new Set(crumbs.map((c) => c.id));
    let cursor: GroupOut | undefined = crumbs[currentIdx];
    let branchChildren: GroupOut[] | null = null;
    while (cursor) {
      const kids = groupsLocalState.filter((g) => g.parent_id === cursor!.id && !g.archived);
      if (kids.length === 0) break; // leaf reached
      if (kids.length > 1) {
        branchChildren = kids; // branches here — let the popover choose
        break;
      }
      const only = kids[0];
      if (guard.has(only.id)) break; // cycle guard
      guard.add(only.id);
      crumbs.push(only);
      cursor = only;
    }
    return { crumbs, currentIdx, branchChildren };
  }, [breadcrumbPath, groupsLocalState]);

  // Total depth of the whole hierarchy this node belongs to (root → deepest leaf),
  // so the user always perceives "how deep it goes", even when the chain stops early
  // at a branch. Root counts as layer 1.
  const totalDepth = useMemo(() => {
    const root = breadcrumbPath[0];
    if (!root) return 1;
    const childrenMap = new Map<string, GroupOut[]>();
    groupsLocalState.forEach((g) => {
      if (g.parent_id && !g.archived) {
        const list = childrenMap.get(g.parent_id) || [];
        list.push(g);
        childrenMap.set(g.parent_id, list);
      }
    });
    function maxDepth(id: string, visited: Set<string>): number {
      if (visited.has(id)) return 0;
      visited.add(id);
      const kids = childrenMap.get(id) || [];
      if (kids.length === 0) return 1;
      return 1 + Math.max(...kids.map((k) => maxDepth(k.id, new Set(visited))));
    }
    return maxDepth(root.id, new Set());
  }, [breadcrumbPath, groupsLocalState]);

  const [activePopoverIdx, setActivePopoverIdx] = useState<number | null>(null);

  const [sourceBookHint, setSourceBookHint] = useState(group.source_book_hint || "");
  const [promptNotes, setPromptNotes] = useState(group.prompt_notes || "");

  // Sub-nodes Quick Add States
  const [newChildName, setNewChildName] = useState("");
  const [addingChild, setAddingChild] = useState(false);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [startingSession, setStartingSession] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Filter out the immediate child active nodes of the current group
  const children = useMemo(() => {
    return groupsLocalState.filter((g) => g.parent_id === group.id && !g.archived);
  }, [groupsLocalState, group.id]);

  // Recursively compute descendant counts for the current group and children
  const descendantCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const childrenMap = new Map<string, string[]>();
    const directCounts = new Map<string, number>();

    groupsLocalState.forEach((g) => {
      const count = g.id === group.id ? group.items.length : g.item_count || 0;
      directCounts.set(g.id, count);
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

    groupsLocalState.forEach((g) => {
      getRecursiveCount(g.id);
    });

    return counts;
  }, [groupsLocalState, group.id, group.items.length]);

  const rootGroup = useMemo(() => {
    const curr = groupsLocalState.find((g) => g.id === group.id);
    if (!curr) return null;
    let root: GroupOut = curr;
    const visited = new Set<string>([root.id]);
    while (root.parent_id) {
      const pid = root.parent_id;
      if (visited.has(pid)) {
        console.warn("Circular reference detected in rootGroup for parent:", pid);
        break;
      }
      visited.add(pid);
      const parent = groupsLocalState.find((g) => g.id === pid);
      if (!parent) break;
      root = parent;
    }
    return root;
  }, [group.id, groupsLocalState]);

  // Autocomplete selections based on matching database directories
  function getAutocompleteOptions(idx: number): string[] {
    if (!groupsLocalState) return [];
    if (idx === 0) {
      return Array.from(
        new Set(
          groupsLocalState
            .filter((g) => !g.parent_id && !g.archived && g.id !== group.id)
            .map((g) => g.name),
        ),
      );
    }
    let currentGroupNodes = groupsLocalState.filter(
      (g) => !g.parent_id && !g.archived && g.id !== group.id,
    );
    for (let i = 0; i < idx; i++) {
      const parentName = levels[i]?.trim().toLowerCase();
      if (!parentName) return [];
      const matchedNode = currentGroupNodes.find((g) => g.name.trim().toLowerCase() === parentName);
      if (!matchedNode) return [];
      currentGroupNodes = groupsLocalState.filter(
        (g) => g.parent_id === matchedNode.id && !g.archived && g.id !== group.id,
      );
    }
    return Array.from(new Set(currentGroupNodes.map((g) => g.name)));
  }

  function getMatchedGroupNode(idx: number): GroupOut | null {
    if (!groupsLocalState) return null;
    let currentGroupNodes = groupsLocalState.filter(
      (g) => !g.parent_id && !g.archived && g.id !== group.id,
    );
    let matched: GroupOut | null = null;
    for (let i = 0; i <= idx; i++) {
      const currentName = levels[i]?.trim().toLowerCase();
      if (!currentName) return null;
      const matchedNode = currentGroupNodes.find(
        (g) => g.name.trim().toLowerCase() === currentName,
      );
      if (!matchedNode) return null;
      matched = matchedNode;
      currentGroupNodes = groupsLocalState.filter(
        (g) => g.parent_id === matchedNode.id && !g.archived && g.id !== group.id,
      );
    }
    return matched;
  }

  // Handle saving the full textbook and hierarchy modifications
  async function handleSave() {
    if (!groupName.trim()) {
      setErrorMsg(t("name_required"));
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    const res = await updateGroup(group.id, {
      name: groupName.trim(),
      source_book_hint: sourceBookHint.trim() || null,
      prompt_notes: promptNotes.trim() || null,
      // The full path of exact tags (root → leaf); the backend nests/merges them
      // deterministically. See docs/content-lifecycle.md §4.4.
      tag_path: levels.map((lvl) => lvl.trim()).filter(Boolean),
      level_titles: levelTitles.map((t) => t.trim()).filter(Boolean),
    });

    setSaving(false);
    if (res.ok) {
      setSuccessMsg(t("save_success"));
      router.refresh();
      setTimeout(() => setSuccessMsg(null), 3000);
    } else {
      setErrorMsg(t("save_failed", { error: res.error }));
    }
  }

  // Quick session launch
  async function handleStartSession() {
    const totalCount = descendantCounts.get(group.id) || group.items.length;
    if (totalCount > 100) {
      const ok = confirm(t("confirm_large_scope", { count: totalCount, cap: 100 }));
      if (!ok) return;
    }
    setStartingSession(true);
    setErrorMsg(null);
    const res = await startSessionFromGroupAction(group.id);
    setStartingSession(false);
    if (res.ok) {
      router.push(`/chat/${res.sessionId}`);
    } else {
      setErrorMsg(t("start_session_failed", { error: res.error }));
    }
  }

  // Delete the textbook leaf node
  async function handleDelete() {
    if (!confirm(t("confirm_delete_permanent", { name: group.name }))) return;
    setDeleting(true);
    const res = await deleteGroup(group.id);
    setDeleting(false);
    if (res.ok) {
      router.push("/parent/materials");
    } else {
      setErrorMsg(t("delete_failed", { error: res.error }));
    }
  }

  // Sub-nodes CRUD triggers
  async function handleArchiveChild(childId: string) {
    if (!confirm(t("confirm_archive_child"))) return;
    const res = await archiveGroup(childId, true);
    if (res.ok) {
      setGroupsLocalState((prev) =>
        prev.map((g) => (g.id === childId ? { ...g, archived: true } : g)),
      );
    } else {
      alert(t("archive_failed", { error: res.error }));
    }
  }

  async function handleAddChild(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newChildName.trim();
    if (!trimmed) return;

    setAddingChild(true);

    // Deduce child kind based on depth in our design schema
    let childKind = "textbook_lesson";
    if (group.kind === "textbook_book") {
      childKind = "textbook_unit";
    } else if (group.kind === "textbook_unit") {
      childKind = "textbook_lesson";
    }

    const res = await createGroup({
      name: trimmed,
      kind: childKind,
      parent_id: group.id,
      items: [],
    });

    setAddingChild(false);
    if (res.ok) {
      setNewChildName("");
      setGroupsLocalState((prev) => [res.group, ...prev]);
      router.refresh();
    } else {
      alert(t("add_child_failed", { error: res.error }));
    }
  }

  // Group items by type for preview display
  const itemsByType = useMemo(() => {
    const acc: Record<ItemType, GroupDetailOut["items"]> = {
      word: [],
      phrase: [],
      pattern: [],
    };
    group.items.forEach((item) => {
      acc[item.type as ItemType].push(item);
    });
    return acc;
  }, [group.items]);

  return (
    <div className="space-y-6">
      {/* Messages */}
      {errorMsg && (
        <Alert variant="destructive" className="border-destructive/20 p-3">
          <AlertDescription>{errorMsg}</AlertDescription>
        </Alert>
      )}
      {successMsg && (
        <Alert variant="success" className="border-success/20 p-3">
          <AlertDescription>{successMsg}</AlertDescription>
        </Alert>
      )}

      {/* Absolute Top: full-chain breadcrumb — ancestors + current + auto-extended
          downstream crumbs, a branch popover where it forks, and a total-depth badge. */}
      {readOnly && (
        <div className="border-border bg-muted/50 flex flex-wrap items-center gap-x-1.5 gap-y-3 rounded-2xl border p-4 py-3 shadow-sm">
          {fullChain.crumbs.map((node, idx) => {
            const title = node.level_title || LEVEL_PRESETS[idx] || t("level_n", { n: idx + 1 });
            const isCurrent = idx === fullChain.currentIdx;
            const isAncestor = idx < fullChain.currentIdx;
            // isDownstream: idx > currentIdx — a real node further down the single-child chain.

            const crumb = (
              <div
                className={cn(
                  "relative flex items-center gap-2 rounded-lg border px-3.5 py-1.5 shadow-sm transition-all duration-200",
                  isCurrent && "border-primary bg-primary/5 ring-ring/10 ring-2",
                  isAncestor &&
                    "border-border bg-card hover:border-primary/30 hover:bg-primary/5 group cursor-pointer hover:shadow",
                  !isCurrent &&
                    !isAncestor &&
                    "border-primary/20 bg-primary/5 hover:border-primary/30 hover:bg-primary/10 group cursor-pointer border-dashed",
                )}
              >
                <div className="flex flex-col items-start leading-none">
                  <span
                    className={cn(
                      "mb-1 flex items-center gap-1 text-[10px] leading-none font-bold tracking-wide uppercase transition-colors",
                      isCurrent
                        ? "text-primary"
                        : isAncestor
                          ? "text-primary/80 group-hover:text-primary"
                          : "text-primary/60 group-hover:text-primary",
                    )}
                  >
                    {title}
                    {isCurrent && (
                      <span className="bg-primary text-primary-foreground rounded-sm px-1 py-px text-[8px] leading-none font-bold tracking-normal normal-case">
                        {t("current_badge")}
                      </span>
                    )}
                  </span>
                  <span
                    className={cn(
                      "text-sm leading-none font-bold transition-colors",
                      isCurrent
                        ? "text-primary"
                        : isAncestor
                          ? "text-foreground group-hover:text-primary"
                          : "text-muted-foreground group-hover:text-primary",
                    )}
                  >
                    {node.name || t("none")}
                  </span>
                </div>
              </div>
            );

            return (
              <div key={node.id} className="flex items-center gap-1">
                {idx > 0 && (
                  <span className="text-muted-foreground/50 px-0.5 text-sm font-extrabold">›</span>
                )}
                {isCurrent ? crumb : <Link href={`/parent/materials/${node.id}`}>{crumb}</Link>}
              </div>
            );
          })}

          {/* Branch point: the chain forks here, so list the children in a popover
              instead of picking one arbitrarily. */}
          {fullChain.branchChildren && (
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground/50 px-0.5 text-sm font-extrabold">›</span>
              <Popover>
                <PopoverTrigger className="border-primary/30 bg-primary/5 text-primary hover:border-primary hover:bg-primary/10 flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-1.5 text-[11px] font-bold transition-all">
                  <ChevronDown className="h-3.5 w-3.5" />
                  {t("branch_children_count", { count: fullChain.branchChildren.length })}
                </PopoverTrigger>
                <PopoverContent align="start" className="w-64 gap-1 p-1.5">
                  <div className="text-muted-foreground/70 px-2 py-1 text-[9px] font-bold tracking-wider uppercase">
                    {t("branch_children_title", { count: fullChain.branchChildren.length })}
                  </div>
                  <div className="max-h-64 space-y-0.5 overflow-y-auto">
                    {fullChain.branchChildren.map((child) => {
                      const ChildIcon = KIND_ICON[child.kind] ?? Bookmark;
                      return (
                        <Link
                          key={child.id}
                          href={`/parent/materials/${child.id}`}
                          className="hover:bg-primary/5 flex items-center gap-2 rounded-lg px-2 py-1.5 transition"
                        >
                          <span className="border-border bg-card text-muted-foreground flex h-6 w-6 shrink-0 items-center justify-center rounded-md border">
                            <ChildIcon className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="text-foreground block truncate text-xs font-semibold">
                              {child.name}
                            </span>
                            <span className="text-muted-foreground block text-[10px]">
                              {t("items_count", { count: child.item_count })}
                            </span>
                          </span>
                          <ArrowUpRight className="text-primary/60 h-3.5 w-3.5 shrink-0" />
                        </Link>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          )}

          {/* Total-depth badge — how deep the whole hierarchy goes. */}
          <span className="text-muted-foreground/50 px-0.5 text-sm font-extrabold">·</span>
          <Badge
            variant="secondary"
            className="bg-muted text-muted-foreground h-auto rounded-md border-0 px-2 py-1 text-[11px] font-bold"
          >
            {t("total_depth", { count: totalDepth })}
          </Badge>
        </div>
      )}

      {/* Floating Toolbar */}
      <div className="border-border/80 bg-background/90 sticky top-14 z-10 flex flex-col justify-between gap-3 rounded-xl border p-4 shadow-md backdrop-blur-md sm:flex-row sm:items-center sm:gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {readOnly ? (
            /* View Mode: Render clean header */
            <div className="flex items-center gap-2.5">
              <div className="bg-primary/10 text-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
                <BookOpen className="text-primary h-5 w-5" />
              </div>
              <div className="min-w-0">
                <span className="text-foreground block text-sm leading-tight font-bold">
                  {t("detail_title")}
                </span>
                <div className="mt-0.5 flex flex-wrap items-center gap-2">
                  <span className="border-primary/20 bg-primary/10 text-primary rounded border px-1.5 py-0.5 text-[9px] leading-none font-bold">
                    {t(KIND_LABEL_KEY[group.kind] ?? "kind_fallback")}
                  </span>
                  <span className="text-muted-foreground text-[11px] leading-none font-medium">
                    {t("detail_view_hint")}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            /* Edit Mode: Original clean layout */
            <div className="flex items-center gap-2.5">
              <div className="bg-primary/10 text-primary flex h-9 w-9 items-center justify-center rounded-lg">
                <BookOpen className="text-primary h-5 w-5 animate-pulse" />
              </div>
              <div>
                <span className="text-foreground block text-sm leading-tight font-bold">
                  {t("editor_title")}
                </span>
                <span className="text-muted-foreground text-[11px]">{t("editor_hint")}</span>
              </div>
            </div>
          )}
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={handleStartSession}
            disabled={startingSession || saving}
            className="border-primary/20 text-primary hover:bg-primary/5 hover:text-primary flex-1 sm:flex-none"
          >
            {startingSession ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <MessageSquare className="mr-2 h-4 w-4" />
            )}
            {t("start_practice_chat")}
          </Button>
          {readOnly ? (
            <Link href={`/parent/materials/${group.id}/edit`} className="flex-1 sm:flex-none">
              <Button size="sm" className="flex w-full items-center justify-center">
                <Edit3 className="mr-2 h-4 w-4" />
                {t("edit_group_button")}
              </Button>
            </Link>
          ) : (
            <Button
              onClick={handleSave}
              disabled={saving || startingSession}
              size="sm"
              className="flex-1 sm:flex-none"
            >
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              {t("save_all_changes")}
            </Button>
          )}
        </div>
      </div>

      {/* Main double column workspace */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left Side: Hierarchy breadcrumb path and Sub-nodes list (Takes 2/3 width) */}
        <div className="space-y-6 lg:col-span-2">
          {readOnly ? null : (
            /* Edit Mode: Keep edit blocks split to modify name and tag levels */
            <>
              {/* Section: Textbook Title & Badge */}
              <Panel className="border-border/80 space-y-4 p-6 shadow-sm">
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className="border-primary/20 bg-primary/10 text-primary h-auto rounded px-2 py-0.5 text-[10px] font-bold"
                  >
                    {t(KIND_LABEL_KEY[group.kind] ?? "kind_fallback")}
                  </Badge>
                  <span className="text-muted-foreground text-xs font-medium">
                    {t("current_node_name")}
                  </span>
                </div>
                <input
                  type="text"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder={t("group_name_placeholder")}
                  className="text-foreground border-border hover:border-input focus:border-primary focus:bg-muted/50 w-full rounded-lg border-b border-dashed bg-transparent px-2 py-1 text-2xl font-extrabold transition duration-150 outline-none"
                />
              </Panel>

              {/* Section: Textbook Hierarchy Path Levels */}
              <Panel className="border-border/80 space-y-4 p-6 shadow-sm">
                <div className="border-b pb-2">
                  <h3 className="text-foreground text-sm font-bold">{t("tag_path_title")}</h3>
                  <p className="text-muted-foreground mt-0.5 text-[11px]">{t("tag_path_hint")}</p>
                </div>

                <div className="border-primary/10 bg-primary/5 space-y-3 rounded-xl border p-4">
                  <label className="text-primary block pl-1 text-[10px] font-bold tracking-wider uppercase">
                    {t("tag_path_label")}
                  </label>
                  <div className="space-y-2.5">
                    {levels.map((lvl, idx) => {
                      const matchedNode = getMatchedGroupNode(idx);
                      const currentTitle = levelTitles[idx] ?? "";
                      return (
                        <Panel
                          key={idx}
                          className="border-border/80 bg-card/60 w-full min-w-0 space-y-1.5 p-3 shadow-sm"
                        >
                          <div className="flex w-full min-w-0 items-center gap-2">
                            {/* 1. Level Title Segment Input with Popover */}
                            <div className="relative w-28 shrink-0">
                              <Popover
                                open={activeLevelTitlePopoverIdx === idx}
                                onOpenChange={(open) =>
                                  setActiveLevelTitlePopoverIdx(open ? idx : null)
                                }
                              >
                                <PopoverTrigger render={<div className="w-full" />}>
                                  <input
                                    type="text"
                                    value={currentTitle}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setLevelTitles((prev) =>
                                        prev.map((x, i) => (i === idx ? val : x)),
                                      );
                                      setActiveLevelTitlePopoverIdx(idx);
                                    }}
                                    onFocus={() => setActiveLevelTitlePopoverIdx(idx)}
                                    onClick={(e) => e.stopPropagation()}
                                    onPointerDown={(e) => e.stopPropagation()}
                                    disabled={saving}
                                    placeholder={LEVEL_PRESETS[idx] || t("level_n", { n: idx + 1 })}
                                    className="border-primary/20 bg-primary/5 text-primary hover:border-primary/30 focus:border-primary/30 focus:bg-background w-full rounded border py-1 pr-6 pl-1.5 text-[10px] font-bold tracking-wide uppercase transition duration-150 outline-none select-all focus:ring-0"
                                  />
                                </PopoverTrigger>
                                <PopoverContent
                                  align="start"
                                  className="border-border bg-popover z-50 max-h-60 w-32 overflow-y-auto rounded-xl border p-1 shadow-xl focus:outline-none"
                                >
                                  <div className="text-muted-foreground/70 mb-1 border-b px-2 py-1 text-[9px] font-bold tracking-wider uppercase">
                                    {t("common_level_titles")}
                                  </div>
                                  <div className="space-y-0.5">
                                    {LEVEL_PRESETS.filter((opt) => opt.includes(currentTitle)).map(
                                      (opt) => (
                                        <button
                                          key={opt}
                                          type="button"
                                          onClick={() => {
                                            setLevelTitles((prev) =>
                                              prev.map((x, i) => (i === idx ? opt : x)),
                                            );
                                            setActiveLevelTitlePopoverIdx(null);
                                          }}
                                          className="hover:bg-primary/5 hover:text-primary flex w-full animate-none items-center justify-between rounded-lg px-2 py-1 text-left text-xs font-medium transition"
                                        >
                                          {opt}
                                        </button>
                                      ),
                                    )}
                                  </div>
                                </PopoverContent>
                              </Popover>
                              <Edit3 className="text-primary/60 pointer-events-none absolute top-1/2 right-1.5 h-2.5 w-2.5 -translate-y-1/2 opacity-60" />
                            </div>

                            {/* 2. Tag Value Input with Popover */}
                            <div className="relative min-w-0 flex-1">
                              <Popover
                                open={activePopoverIdx === idx}
                                onOpenChange={(open) => setActivePopoverIdx(open ? idx : null)}
                              >
                                <PopoverTrigger render={<div className="w-full" />}>
                                  <input
                                    type="text"
                                    value={lvl}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setLevels((prev) =>
                                        prev.map((x, i) => (i === idx ? val : x)),
                                      );
                                      setActivePopoverIdx(idx);
                                    }}
                                    onFocus={() => setActivePopoverIdx(idx)}
                                    onClick={(e) => e.stopPropagation()}
                                    onPointerDown={(e) => e.stopPropagation()}
                                    disabled={saving}
                                    placeholder={t("level_name_placeholder")}
                                    className="bg-background border-border focus:ring-ring w-full rounded-lg border py-1.5 pr-8 pl-3 text-sm font-medium outline-none focus:ring-1 disabled:opacity-50"
                                  />
                                </PopoverTrigger>
                                <PopoverContent
                                  align="start"
                                  className="border-border bg-popover z-50 max-h-60 w-80 overflow-y-auto rounded-xl border p-1 shadow-xl focus:outline-none"
                                >
                                  <div className="text-muted-foreground/70 mb-1 border-b px-2.5 py-1 text-[9px] font-bold tracking-wider uppercase">
                                    {t("select_existing_level")}
                                  </div>
                                  {getAutocompleteOptions(idx).length === 0 ? (
                                    <div className="text-muted-foreground px-3 py-2.5 text-xs italic">
                                      {t("no_matching_level")}
                                    </div>
                                  ) : (
                                    <div className="space-y-0.5">
                                      {getAutocompleteOptions(idx)
                                        .filter((opt) =>
                                          opt.toLowerCase().includes(lvl.toLowerCase()),
                                        )
                                        .map((opt) => (
                                          <button
                                            key={opt}
                                            type="button"
                                            onClick={() => {
                                              setLevels((prev) =>
                                                prev.map((x, i) => (i === idx ? opt : x)),
                                              );
                                              setActivePopoverIdx(null);
                                            }}
                                            className="hover:bg-primary/5 hover:text-primary flex w-full animate-none items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition"
                                          >
                                            <span>{opt}</span>
                                            <span className="py-0.2 border-success/30 bg-success/10 text-success shrink-0 rounded border px-1 text-[9px] font-semibold">
                                              {t("exists_badge")}
                                            </span>
                                          </button>
                                        ))}
                                    </div>
                                  )}
                                  {lvl.trim() && !getAutocompleteOptions(idx).includes(lvl) && (
                                    <div className="mt-1 border-t pt-1">
                                      <button
                                        type="button"
                                        onClick={() => setActivePopoverIdx(null)}
                                        className="text-primary hover:bg-primary/5 w-full rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold transition"
                                      >
                                        {t("create_under_branch", { name: lvl })}
                                      </button>
                                    </div>
                                  )}
                                </PopoverContent>
                              </Popover>
                              <Edit3 className="text-muted-foreground/70 pointer-events-none absolute top-1/2 right-2 h-3.5 w-3.5 -translate-y-1/2" />
                            </div>

                            {/* 3. Delete Action Button */}
                            {levels.length > 1 && !saving && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => {
                                  setLevels((prev) => prev.filter((_, i) => i !== idx));
                                  setLevelTitles((prev) => prev.filter((_, i) => i !== idx));
                                }}
                                className="text-muted-foreground hover:text-destructive shrink-0"
                                title={t("delete_level_tooltip")}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            )}
                          </div>

                          {/* Match Status Badge */}
                          {lvl.trim() && (
                            <div className="flex items-center pl-[120px]">
                              {matchedNode ? (
                                <span className="animate-in fade-in slide-in-from-left-1 border-success/20 bg-success/10 text-success inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium backdrop-blur-sm duration-200">
                                  <span className="bg-success h-1.5 w-1.5 animate-pulse rounded-full" />
                                  {t("matched_existing", { name: matchedNode.name })}
                                </span>
                              ) : (
                                <span className="animate-in fade-in slide-in-from-left-1 border-primary/20 bg-primary/10 text-primary inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium backdrop-blur-sm duration-200">
                                  <span className="bg-primary/60 h-1.5 w-1.5 rounded-full" />
                                  {idx === levels.length - 1
                                    ? t("new_name_for_current")
                                    : t("will_create_level")}
                                </span>
                              )}
                            </div>
                          )}
                        </Panel>
                      );
                    })}
                  </div>

                  {!saving && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setLevels((prev) => [...prev, ""]);
                        setLevelTitles((prev) => [
                          ...prev,
                          LEVEL_PRESETS[levels.length] || t("level_n", { n: levels.length + 1 }),
                        ]);
                      }}
                      className="border-primary/20 text-primary hover:bg-primary/5 mt-2 border-dashed text-xs"
                    >
                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                      {t("add_level_button")}
                    </Button>
                  )}
                </div>
              </Panel>
            </>
          )}

          {/* Section: Sub-nodes / Sub-chapters manager list */}
          {(!readOnly || children.length > 0) && (
            <Panel
              id="sub-chapters-list"
              className={cn(
                "border-border/80 scroll-mt-24 space-y-4 p-6 shadow-sm transition-all duration-500",
                highlightSubChapters &&
                  "border-primary bg-primary/5 shadow-primary/30 ring-ring shadow-lg ring-2",
              )}
            >
              <div className="flex items-center justify-between border-b pb-2.5">
                <div>
                  <h3 className="text-foreground text-sm font-bold">{t("sub_chapters_title")}</h3>
                  <p className="text-muted-foreground mt-0.5 text-[11px]">
                    {readOnly ? t("sub_chapters_hint_view") : t("sub_chapters_hint_edit")}
                  </p>
                </div>
                <Badge
                  variant="secondary"
                  className="bg-muted text-muted-foreground h-auto shrink-0 rounded border-0 px-2.5 py-0.5 text-[10px] font-semibold"
                >
                  {t("children_count", { count: children.length })}
                </Badge>
              </div>

              <div className="space-y-2">
                {children.length === 0 ? (
                  <div className="bg-muted/30 rounded-lg border border-dashed py-8 text-center">
                    <FolderPlus className="text-muted-foreground/50 mx-auto mb-1.5 h-6 w-6" />
                    <p className="text-muted-foreground text-xs italic">{t("no_children")}</p>
                    <p className="text-muted-foreground mt-0.5 text-[10px]">
                      {t("no_children_hint")}
                    </p>
                  </div>
                ) : (
                  <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                    {children.map((child) => {
                      const ChildIcon = KIND_ICON[child.kind] ?? Bookmark;
                      return (
                        <div
                          key={child.id}
                          className="border-border bg-muted/15 hover:border-primary/20 hover:bg-primary/5 group flex items-center justify-between rounded-xl border p-3 transition duration-150"
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-3">
                            <div className="border-border bg-card text-foreground/80 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border shadow-sm">
                              <ChildIcon className="h-4 w-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              {readOnly ? (
                                <span className="text-foreground block max-w-sm truncate py-0.5 pl-1.5 text-sm font-semibold">
                                  {child.name}
                                </span>
                              ) : (
                                <input
                                  type="text"
                                  defaultValue={child.name}
                                  onBlur={async (e) => {
                                    const newName = e.target.value.trim();
                                    if (newName && newName !== child.name) {
                                      const res = await renameGroup(child.id, newName);
                                      if (res.ok) {
                                        setGroupsLocalState((prev) =>
                                          prev.map((g) =>
                                            g.id === child.id ? { ...g, name: newName } : g,
                                          ),
                                        );
                                      } else {
                                        alert(t("rename_failed", { error: res.error }));
                                      }
                                    }
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.currentTarget.blur();
                                    }
                                  }}
                                  className="text-foreground hover:border-border focus:border-primary focus:bg-background w-full max-w-sm rounded border-b border-transparent bg-transparent px-1.5 py-0.5 text-sm font-semibold transition outline-none"
                                  placeholder={t("child_name_placeholder")}
                                />
                              )}
                              <span className="text-muted-foreground mt-0.5 block pl-1.5 text-[9px]">
                                {t("items_count", { count: child.item_count })} ·{" "}
                                {t(KIND_LABEL_KEY[child.kind] ?? "kind_textbook_lesson")}
                              </span>
                            </div>
                          </div>

                          <div className="ml-3 flex shrink-0 items-center gap-1.5">
                            <Link
                              href={`/parent/materials/${child.id}`}
                              className="border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 flex h-7 items-center rounded border px-2.5 text-[10px] font-semibold shadow-sm transition"
                              title={
                                readOnly ? t("view_chapter_tooltip") : t("edit_chapter_tooltip")
                              }
                            >
                              {readOnly ? t("view") : t("manage")}
                              <ArrowUpRight className="ml-0.5 h-3 w-3" />
                            </Link>
                            {!readOnly && (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => handleArchiveChild(child.id)}
                                className="text-muted-foreground hover:text-destructive shrink-0"
                                title={t("archive_child_tooltip")}
                              >
                                <Archive className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Quick Add Child Form */}
                {!readOnly && (
                  <form onSubmit={handleAddChild} className="mt-2 flex gap-2 border-t pt-3">
                    <input
                      type="text"
                      value={newChildName}
                      onChange={(e) => setNewChildName(e.target.value)}
                      placeholder={
                        group.kind === "textbook_book"
                          ? t("new_unit_placeholder")
                          : group.kind === "textbook_unit"
                            ? t("new_lesson_placeholder")
                            : t("new_child_placeholder")
                      }
                      disabled={addingChild}
                      className="bg-background border-border focus:ring-ring min-w-0 flex-1 rounded-lg border px-3 py-1.5 text-xs outline-none focus:ring-1"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      disabled={addingChild || !newChildName.trim()}
                      className="bg-primary/5 text-primary hover:bg-primary/10 h-8 shrink-0 px-3 text-xs font-semibold"
                    >
                      {addingChild ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <>
                          <Plus className="mr-1 h-3.5 w-3.5" />
                          {t("quick_add")}
                        </>
                      )}
                    </Button>
                  </form>
                )}
              </div>
            </Panel>
          )}

          {/* Section: Core Learning Points Outline (only shown in View Mode for leaf nodes) */}
          {readOnly && children.length === 0 && (
            <Panel className="border-border/80 animate-in fade-in space-y-5 p-6 shadow-sm duration-200">
              <div className="flex items-center justify-between border-b pb-3.5">
                <div>
                  <h3 className="text-foreground text-sm font-bold">{t("outline_title")}</h3>
                  <p className="text-muted-foreground mt-0.5 text-[11px]">{t("outline_hint")}</p>
                </div>
                <Badge className="bg-primary/5 text-primary h-auto shrink-0 rounded border-0 px-2.5 py-0.5 text-[10px] font-semibold">
                  {t("total_items_count", { count: group.items.length })}
                </Badge>
              </div>

              {group.items.length === 0 ? (
                <div className="bg-muted/30 rounded-lg border border-dashed py-12 text-center">
                  <BookOpen className="text-muted-foreground/50 mx-auto mb-2 h-7 w-7 animate-pulse" />
                  <p className="text-muted-foreground text-xs italic">{t("no_items_yet")}</p>
                  <p className="text-muted-foreground mt-1 text-[10px]">{t("no_items_hint")}</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* 1. Words */}
                  {itemsByType.word.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-muted-foreground/70 flex items-center gap-1.5 pl-0.5 text-[11px] font-bold tracking-wider uppercase">
                        <span className="bg-primary h-1.5 w-1.5 rounded-full" />
                        {t("outline_words", { count: itemsByType.word.length })}
                      </h4>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {itemsByType.word.map((item, idx) => (
                          <div
                            key={idx}
                            className="border-border/80 bg-muted/20 flex items-center justify-between rounded-lg border px-3 py-2 text-xs"
                          >
                            <span className="text-foreground font-bold select-all">
                              {item.text}
                            </span>
                            <div className="flex gap-1">
                              {item.pos && (
                                <span className="py-0.2 border-primary/10 bg-primary/5 text-primary rounded border px-1.5 text-[9px] leading-none font-medium">
                                  {item.pos}
                                </span>
                              )}
                              {item.cefr_level && (
                                <span className="py-0.2 border-success/15 bg-success/5 text-success rounded border px-1.5 text-[9px] leading-none font-medium">
                                  {item.cefr_level}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 2. Phrases */}
                  {itemsByType.phrase.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-muted-foreground/70 flex items-center gap-1.5 pl-0.5 text-[11px] font-bold tracking-wider uppercase">
                        <span className="bg-success h-1.5 w-1.5 rounded-full" />
                        {t("outline_phrases", { count: itemsByType.phrase.length })}
                      </h4>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {itemsByType.phrase.map((item, idx) => (
                          <div
                            key={idx}
                            className="border-border/80 bg-muted/20 flex items-center justify-between rounded-lg border px-3 py-2 text-xs"
                          >
                            <span className="text-foreground font-bold select-all">
                              {item.text}
                            </span>
                            {item.cefr_level && (
                              <span className="py-0.2 border-success/15 bg-success/5 text-success rounded border px-1.5 text-[9px] leading-none font-medium">
                                {item.cefr_level}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 3. Patterns */}
                  {itemsByType.pattern.length > 0 && (
                    <div className="space-y-2.5">
                      <h4 className="text-muted-foreground/70 flex items-center gap-1.5 pl-0.5 text-[11px] font-bold tracking-wider uppercase">
                        <span className="bg-warning h-1.5 w-1.5 rounded-full" />
                        {t("outline_patterns", { count: itemsByType.pattern.length })}
                      </h4>
                      <div className="space-y-2">
                        {itemsByType.pattern.map((item, idx) => (
                          <div
                            key={idx}
                            className="border-border/80 bg-muted/20 space-y-1.5 rounded-lg border p-3 text-xs"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-foreground font-bold select-all">
                                {item.text}
                              </span>
                              {item.cefr_level && (
                                <span className="py-0.2 border-success/15 bg-success/5 text-success rounded border px-1.5 text-[9px] leading-none font-medium">
                                  {item.cefr_level}
                                </span>
                              )}
                            </div>
                            {item.anchor && (
                              <div className="border-border bg-card/60 text-muted-foreground flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px]">
                                <span className="text-muted-foreground/70 text-[8px] font-bold tracking-wide uppercase">
                                  {t("anchor_short_label")}
                                </span>
                                <span className="font-mono font-medium">{item.anchor}</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Panel>
          )}
        </div>

        {/* Right Side: Learning Points Summary & Metadatas (Takes 1/3 width) */}
        <div className="space-y-6 lg:col-span-1">
          {/* Learning Points Overview Card */}
          <Panel className="border-border/80 space-y-4 p-5 shadow-sm">
            <div className="flex flex-col items-start gap-1.5 border-b pb-2">
              <h3 className="text-foreground text-sm font-bold">{t("mastery_overview_title")}</h3>
              <Badge
                variant="outline"
                className="border-primary/20 bg-primary/5 text-primary h-auto rounded-full px-2.5 py-0.5 text-[10px] font-semibold"
              >
                {(() => {
                  const direct = group.items.length;
                  const total = descendantCounts.get(group.id) || direct;
                  // Lead with the meaningful number: a container node's own "0" is normal,
                  // not a deficiency, so it never takes the headline slot.
                  if (direct === 0 && total > 0) return t("count_from_children", { count: total });
                  if (total > direct) return t("count_with_children", { direct, total });
                  return t("count_total", { count: direct });
                })()}
              </Badge>
            </div>

            {group.items.length === 0 ? (
              (() => {
                const total = descendantCounts.get(group.id) || 0;
                // Container node: don't show a fake "0 / 0 / 0" type split (it reads as
                // "empty"). Lead with the real reachable total; the per-type breakdown
                // lives on the leaf nodes that actually hold the items.
                if (total > 0) {
                  return (
                    <div className="space-y-3">
                      <div className="border-primary/20 bg-primary/5 rounded-xl border p-4 text-center shadow-sm">
                        <span className="text-primary block text-2xl leading-none font-bold">
                          {total}
                        </span>
                        <span className="text-muted-foreground mt-1.5 block text-[10px] font-semibold">
                          {t("items_in_children_label")}
                        </span>
                      </div>
                      <p className="text-muted-foreground pl-1 text-[10px] leading-relaxed italic">
                        {t("container_node_tip")}
                      </p>
                    </div>
                  );
                }
                // Genuinely empty: no direct items and no descendants either.
                return (
                  <div className="bg-muted/30 rounded-xl border border-dashed py-8 text-center">
                    <BookOpen className="text-muted-foreground/50 mx-auto mb-1.5 h-6 w-6" />
                    <p className="text-muted-foreground text-xs italic">
                      {readOnly ? t("node_empty_view") : t("node_empty_edit")}
                    </p>
                    <p className="text-muted-foreground mt-1 text-[10px]">
                      {readOnly ? t("node_empty_view_hint") : t("node_empty_edit_hint")}
                    </p>
                  </div>
                );
              })()
            ) : (
              <div className="grid grid-cols-3 gap-2">
                <div className="border-primary/20 bg-primary/5 rounded-xl border p-3 text-center">
                  <span className="text-primary block text-xl font-bold">
                    {itemsByType.word.length}
                  </span>
                  <span className="text-muted-foreground mt-0.5 block text-[9px] font-semibold">
                    {t("words_label")}
                  </span>
                </div>
                <div className="border-success/30 bg-success/5 rounded-xl border p-3 text-center">
                  <span className="text-success block text-xl font-bold">
                    {itemsByType.phrase.length}
                  </span>
                  <span className="text-muted-foreground mt-0.5 block text-[9px] font-semibold">
                    {t("phrases_label")}
                  </span>
                </div>
                <div className="border-warning/40 bg-warning/5 rounded-xl border p-3 text-center">
                  <span className="text-warning block text-xl font-bold">
                    {itemsByType.pattern.length}
                  </span>
                  <span className="text-muted-foreground mt-0.5 block text-[9px] font-semibold">
                    {t("patterns_label")}
                  </span>
                </div>
              </div>
            )}

            {/* Preview of items inside the book */}
            {group.items.length > 0 && (
              <div className="space-y-2 border-t pt-3">
                <span className="text-muted-foreground block text-[10px] font-bold tracking-wider uppercase">
                  {t("outline_preview_title")}
                </span>
                <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
                  {group.items.slice(0, 10).map((it, idx) => (
                    <Badge
                      key={idx}
                      variant={
                        it.type === "word"
                          ? "outline"
                          : it.type === "phrase"
                            ? "success"
                            : "warning"
                      }
                      className={cn(
                        "h-auto rounded px-2 py-0.5 text-[10px] font-semibold whitespace-normal",
                        it.type === "word"
                          ? "border-primary/20 bg-primary/5 text-primary"
                          : it.type === "phrase"
                            ? "border-success/30 bg-success/10"
                            : "border-warning/40 bg-warning/10",
                      )}
                    >
                      {it.text}
                    </Badge>
                  ))}
                  {group.items.length > 10 && (
                    <span className="text-muted-foreground self-center pl-1 text-[9px] font-medium">
                      {t("more_items", { count: group.items.length - 10 })}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Link button to transition to items secondary page */}
            <Link
              href={`/parent/materials/${group.id}/items`}
              className="block w-full border-t pt-3"
            >
              <Button
                className="bg-primary text-primary-foreground hover:bg-primary/90 flex w-full items-center justify-center gap-1.5 py-2 text-xs font-semibold shadow-sm"
                size="sm"
              >
                <BookOpen className="h-3.5 w-3.5" />
                {readOnly ? t("view_items_link") : t("manage_items_link")}
              </Button>
            </Link>
          </Panel>

          {/* Learner Assignment Card */}
          {learnerCount > 1 && (
            <Panel className="border-border/80 space-y-3 p-5 shadow-sm">
              <div className="flex items-center gap-2.5">
                <div className="bg-primary/5 text-primary flex h-8 w-8 items-center justify-center rounded-lg">
                  <Users className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-foreground text-sm font-bold">{t("learner_assign_title")}</p>
                  <p className="text-muted-foreground text-[11px]">
                    {rootGroup && rootGroup.id !== group.id
                      ? t("inherit_assign_hint", { name: rootGroup.name })
                      : t("manage_assign_hint")}
                  </p>
                </div>
              </div>
              <Link
                href={`/parent/materials/${rootGroup ? rootGroup.id : group.id}/learners`}
                className="block w-full"
              >
                <Button
                  variant="outline"
                  className="border-primary/20 text-primary hover:bg-primary/5 hover:text-primary/80 w-full justify-center gap-1.5 text-xs font-semibold"
                  size="sm"
                >
                  <Users className="h-3.5 w-3.5" />
                  {rootGroup && rootGroup.id !== group.id
                    ? t("manage_parent_assign_link")
                    : t("manage_learner_assign_link")}
                </Button>
              </Link>
            </Panel>
          )}

          {/* AI Prompts & Hints metadata Card */}
          {(!readOnly || sourceBookHint.trim() || promptNotes.trim()) && (
            <Panel className="border-border/80 space-y-4 p-5 shadow-sm">
              <h3 className="text-foreground text-sm font-bold">{t("metadata_title")}</h3>

              {/* Source Book Hint */}
              {(!readOnly || sourceBookHint.trim()) && (
                <div className="space-y-1">
                  <label className="text-muted-foreground block text-[11px] font-semibold">
                    {t("source_hint_label")}
                  </label>
                  {readOnly ? (
                    <div className="border-border bg-muted/25 text-foreground/80 rounded-lg border px-3 py-2 text-xs font-medium">
                      {sourceBookHint}
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={sourceBookHint}
                      onChange={(e) => setSourceBookHint(e.target.value)}
                      placeholder={t("source_hint_placeholder")}
                      className="border-input bg-background focus:ring-ring w-full rounded-lg border px-3 py-1.5 text-xs outline-none focus:ring-1"
                    />
                  )}
                </div>
              )}

              {/* Prompt Notes */}
              {(!readOnly || promptNotes.trim()) && (
                <div className="space-y-1">
                  <label className="text-muted-foreground block text-[11px] font-semibold">
                    {t("prompt_notes_label")}
                  </label>
                  {readOnly ? (
                    <div className="border-border bg-muted/25 text-foreground/80 rounded-lg border px-3 py-2 text-xs leading-relaxed font-medium whitespace-pre-wrap">
                      {promptNotes}
                    </div>
                  ) : (
                    <textarea
                      value={promptNotes}
                      onChange={(e) => setPromptNotes(e.target.value)}
                      placeholder={t("prompt_notes_placeholder")}
                      rows={4}
                      className="border-input bg-background focus:ring-ring w-full resize-none rounded-lg border px-3 py-2 text-xs outline-none focus:ring-1"
                    />
                  )}
                </div>
              )}

              {/* Delete Danger Zone */}
              {!readOnly && (
                <div className="border-t pt-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDelete}
                    disabled={deleting}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive w-full justify-start text-xs"
                  >
                    {deleting ? (
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="mr-2 h-3.5 w-3.5" />
                    )}
                    {t("delete_group_button")}
                  </Button>
                </div>
              )}
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
