"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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

const KIND_LABEL: Record<string, string> = {
  textbook_book: "教材",
  textbook_unit: "单元",
  textbook_lesson: "课次",
  personal_collection: "生词本",
  quick_practice: "随手练习",
  review_set: "复习集",
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
    initialLevels.length > 0 ? initialLevels : ["未分类教材"],
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
      (node, idx) => node.level_title || LEVEL_PRESETS[idx] || `层级 ${idx + 1}`,
    );
  }, [group.id, groupsLocalState]);

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
      setErrorMsg("教材名称不能为空");
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
      setSuccessMsg("保存成功！");
      router.refresh();
      setTimeout(() => setSuccessMsg(null), 3000);
    } else {
      setErrorMsg(`保存失败: ${res.error}`);
    }
  }

  // Quick session launch
  async function handleStartSession() {
    const totalCount = descendantCounts.get(group.id) || group.items.length;
    if (totalCount > 100) {
      const ok = confirm(
        `当前选择的教材层级包含词句较多（共 ${totalCount} 个）。\n为了保证最佳对话练习效果，AI 老师将智能优先挑选您还未掌握的词句（最多 100 个）进行重点操练。\n建议您也可以选择具体单元或课次进行针对性练习。\n\n是否继续？`,
      );
      if (!ok) return;
    }
    setStartingSession(true);
    setErrorMsg(null);
    const res = await startSessionFromGroupAction(group.id);
    setStartingSession(false);
    if (res.ok) {
      router.push(`/chat/${res.sessionId}`);
    } else {
      setErrorMsg(`启动对话失败: ${res.error}`);
    }
  }

  // Delete the textbook leaf node
  async function handleDelete() {
    if (!confirm(`确定彻底删除素材 "${group.name}" 吗？此操作无法恢复。`)) return;
    setDeleting(true);
    const res = await deleteGroup(group.id);
    setDeleting(false);
    if (res.ok) {
      router.push("/parent/materials");
    } else {
      setErrorMsg(`删除失败: ${res.error}`);
    }
  }

  // Sub-nodes CRUD triggers
  async function handleArchiveChild(childId: string) {
    if (!confirm("确定将该子章节归档吗？归档后可随时恢复。")) return;
    const res = await archiveGroup(childId, true);
    if (res.ok) {
      setGroupsLocalState((prev) =>
        prev.map((g) => (g.id === childId ? { ...g, archived: true } : g)),
      );
    } else {
      alert(`归档失败: ${res.error}`);
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
      alert(`添加子章节失败: ${res.error}`);
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
        <div className="border-destructive/20 bg-destructive/10 text-destructive rounded-lg border p-3 text-sm">
          {errorMsg}
        </div>
      )}
      {successMsg && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-600">
          {successMsg}
        </div>
      )}

      {/* Absolute Top: full-chain breadcrumb — ancestors + current + auto-extended
          downstream crumbs, a branch popover where it forks, and a total-depth badge. */}
      {readOnly && (
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-3 rounded-2xl border border-slate-100 bg-slate-50/50 p-4 py-3 shadow-sm dark:border-slate-800/40 dark:bg-slate-950/20">
          {fullChain.crumbs.map((node, idx) => {
            const title = node.level_title || LEVEL_PRESETS[idx] || `层级 ${idx + 1}`;
            const isCurrent = idx === fullChain.currentIdx;
            const isAncestor = idx < fullChain.currentIdx;
            // isDownstream: idx > currentIdx — a real node further down the single-child chain.

            const crumb = (
              <div
                className={cn(
                  "relative flex items-center gap-2 rounded-lg border px-3.5 py-1.5 shadow-sm transition-all duration-200",
                  isCurrent &&
                    "border-indigo-500 bg-indigo-50/70 ring-2 ring-indigo-500/10 dark:bg-indigo-950/40",
                  isAncestor &&
                    "group cursor-pointer border-slate-100 bg-white hover:border-indigo-300 hover:bg-indigo-50/30 hover:shadow dark:border-slate-800/40 dark:bg-slate-950/20",
                  !isCurrent &&
                    !isAncestor &&
                    "group cursor-pointer border-dashed border-indigo-200 bg-indigo-50/10 hover:border-indigo-300 hover:bg-indigo-50/30 dark:border-indigo-900/50 dark:bg-indigo-950/10",
                )}
              >
                <div className="flex flex-col items-start leading-none">
                  <span
                    className={cn(
                      "mb-1 flex items-center gap-1 text-[10px] leading-none font-bold tracking-wide uppercase transition-colors",
                      isCurrent
                        ? "text-indigo-600 dark:text-indigo-400"
                        : isAncestor
                          ? "text-indigo-500 group-hover:text-indigo-600"
                          : "text-indigo-400/80 group-hover:text-indigo-600",
                    )}
                  >
                    {title}
                    {isCurrent && (
                      <span className="rounded-sm bg-indigo-600 px-1 py-px text-[8px] leading-none font-bold tracking-normal text-white normal-case">
                        当前
                      </span>
                    )}
                  </span>
                  <span
                    className={cn(
                      "text-sm leading-none font-bold transition-colors",
                      isCurrent
                        ? "text-indigo-950 dark:text-white"
                        : isAncestor
                          ? "text-slate-800 group-hover:text-indigo-600 dark:text-slate-200"
                          : "text-slate-500 group-hover:text-indigo-700 dark:text-slate-400",
                    )}
                  >
                    {node.name || "无"}
                  </span>
                </div>
              </div>
            );

            return (
              <div key={node.id} className="flex items-center gap-1">
                {idx > 0 && (
                  <span className="px-0.5 text-sm font-extrabold text-slate-300 dark:text-slate-700">
                    ›
                  </span>
                )}
                {isCurrent ? crumb : <Link href={`/parent/materials/${node.id}`}>{crumb}</Link>}
              </div>
            );
          })}

          {/* Branch point: the chain forks here, so list the children in a popover
              instead of picking one arbitrarily. */}
          {fullChain.branchChildren && (
            <div className="flex items-center gap-1">
              <span className="px-0.5 text-sm font-extrabold text-slate-300 dark:text-slate-700">
                ›
              </span>
              <Popover>
                <PopoverTrigger className="flex items-center gap-1.5 rounded-lg border border-dashed border-indigo-300 bg-indigo-50/20 px-3 py-1.5 text-[11px] font-bold text-indigo-600 transition-all hover:border-indigo-400 hover:bg-indigo-100/30 hover:text-indigo-800">
                  <ChevronDown className="h-3.5 w-3.5" />含 {fullChain.branchChildren.length} 个下级
                </PopoverTrigger>
                <PopoverContent align="start" className="w-64 gap-1 p-1.5">
                  <div className="px-2 py-1 text-[9px] font-bold tracking-wider text-slate-400 uppercase">
                    下级章节（{fullChain.branchChildren.length}）
                  </div>
                  <div className="max-h-64 space-y-0.5 overflow-y-auto">
                    {fullChain.branchChildren.map((child) => {
                      const ChildIcon = KIND_ICON[child.kind] ?? Bookmark;
                      return (
                        <Link
                          key={child.id}
                          href={`/parent/materials/${child.id}`}
                          className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition hover:bg-indigo-50 dark:hover:bg-indigo-950/30"
                        >
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-slate-100 bg-white text-slate-600 dark:border-slate-800 dark:bg-slate-950">
                            <ChildIcon className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-semibold text-slate-800 dark:text-slate-200">
                              {child.name}
                            </span>
                            <span className="text-muted-foreground block text-[10px]">
                              {child.item_count} 个学习点
                            </span>
                          </span>
                          <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
                        </Link>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          )}

          {/* Total-depth badge — how deep the whole hierarchy goes. */}
          <span className="px-0.5 text-sm font-extrabold text-slate-300 dark:text-slate-700">
            ·
          </span>
          <span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            共 {totalDepth} 层
          </span>
        </div>
      )}

      {/* Floating Toolbar */}
      <div className="border-border/80 bg-background/90 sticky top-14 z-10 flex flex-col justify-between gap-3 rounded-xl border p-4 shadow-md backdrop-blur-md sm:flex-row sm:items-center sm:gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {readOnly ? (
            /* View Mode: Render clean header */
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40">
                <BookOpen className="h-5 w-5 text-indigo-600" />
              </div>
              <div className="min-w-0">
                <span className="text-foreground block text-sm leading-tight font-bold">
                  教材详情
                </span>
                <div className="mt-0.5 flex flex-wrap items-center gap-2">
                  <span className="rounded border border-indigo-100 bg-indigo-50 px-1.5 py-0.5 text-[9px] leading-none font-bold text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-400">
                    {KIND_LABEL[group.kind] || "素材"}
                  </span>
                  <span className="text-muted-foreground text-[11px] leading-none font-medium">
                    查看此素材的归属、包含的学习点及子章节目录
                  </span>
                </div>
              </div>
            </div>
          ) : (
            /* Edit Mode: Original clean layout */
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40">
                <BookOpen className="h-5 w-5 animate-pulse text-indigo-600" />
              </div>
              <div>
                <span className="text-foreground block text-sm leading-tight font-bold">
                  目录结构编辑器
                </span>
                <span className="text-muted-foreground text-[11px]">
                  精细化规划层级、关联并新增下一级章节
                </span>
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
            className="flex-1 border-indigo-200 text-indigo-700 hover:bg-indigo-50 hover:text-indigo-800 sm:flex-none"
          >
            {startingSession ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <MessageSquare className="mr-2 h-4 w-4" />
            )}
            开始对话练习
          </Button>
          {readOnly ? (
            <Link href={`/parent/materials/${group.id}/edit`} className="flex-1 sm:flex-none">
              <Button
                size="sm"
                className="flex w-full items-center justify-center bg-indigo-600 text-white hover:bg-indigo-700"
              >
                <Edit3 className="mr-2 h-4 w-4" />
                编辑教材
              </Button>
            </Link>
          ) : (
            <Button
              onClick={handleSave}
              disabled={saving || startingSession}
              size="sm"
              className="flex-1 bg-indigo-600 text-white hover:bg-indigo-700 sm:flex-none"
            >
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              保存所有修改
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
              <div className="border-border/80 bg-card space-y-4 rounded-xl border p-6 shadow-sm">
                <div className="flex items-center gap-2">
                  <span className="rounded border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-400">
                    {KIND_LABEL[group.kind] || "素材"}
                  </span>
                  <span className="text-muted-foreground text-xs font-medium">当前节点名称</span>
                </div>
                <input
                  type="text"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="请输入教材/章节名称..."
                  className="text-foreground w-full rounded-lg border-b border-dashed border-slate-200 bg-transparent px-2 py-1 text-2xl font-extrabold transition duration-150 outline-none hover:border-slate-400 focus:border-indigo-600 focus:bg-slate-50/50"
                />
              </div>

              {/* Section: Textbook Hierarchy Path Levels */}
              <div className="border-border/80 bg-card space-y-4 rounded-xl border p-6 shadow-sm">
                <div className="border-b pb-2">
                  <h3 className="text-foreground text-sm font-bold">教材归属路径 (Tag Path)</h3>
                  <p className="text-muted-foreground mt-0.5 text-[11px]">
                    用一串标签指定当前内容在教材库中的归属，由根部到叶子，如 Tot Talk › Book 1 ›
                    Unit 1。
                  </p>
                </div>

                <div className="space-y-3 rounded-xl border border-indigo-500/10 bg-indigo-500/5 p-4">
                  <label className="block pl-1 text-[10px] font-bold tracking-wider text-indigo-800 uppercase">
                    标签路径（由根部到叶子）
                  </label>
                  <div className="space-y-2.5">
                    {levels.map((lvl, idx) => {
                      const matchedNode = getMatchedGroupNode(idx);
                      const currentTitle = levelTitles[idx] ?? "";
                      return (
                        <div
                          key={idx}
                          className="w-full min-w-0 space-y-1.5 rounded-xl border border-slate-100/80 bg-white/60 p-3 shadow-sm dark:border-slate-800/40 dark:bg-slate-950/20"
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
                                    placeholder={LEVEL_PRESETS[idx] || `层级 ${idx + 1}`}
                                    className="w-full rounded border border-indigo-100 bg-indigo-50/50 py-1 pr-6 pl-1.5 text-[10px] font-bold tracking-wide text-indigo-700 uppercase transition duration-150 outline-none select-all hover:border-indigo-200 focus:border-indigo-300 focus:bg-white focus:ring-0"
                                  />
                                </PopoverTrigger>
                                <PopoverContent
                                  align="start"
                                  className="z-50 max-h-60 w-32 overflow-y-auto rounded-xl border border-slate-100 bg-white p-1 shadow-xl focus:outline-none"
                                >
                                  <div className="mb-1 border-b px-2 py-1 text-[9px] font-bold tracking-wider text-slate-400 uppercase">
                                    常用属性
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
                                          className="flex w-full animate-none items-center justify-between rounded-lg px-2 py-1 text-left text-xs font-medium transition hover:bg-indigo-50 hover:text-indigo-600"
                                        >
                                          {opt}
                                        </button>
                                      ),
                                    )}
                                  </div>
                                </PopoverContent>
                              </Popover>
                              <Edit3 className="pointer-events-none absolute top-1/2 right-1.5 h-2.5 w-2.5 -translate-y-1/2 text-indigo-400 opacity-60" />
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
                                    placeholder={`输入级别名称，如 Book 1 / Unit 2...`}
                                    className="bg-background border-border w-full rounded-lg border py-1.5 pr-8 pl-3 text-sm font-medium outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
                                  />
                                </PopoverTrigger>
                                <PopoverContent
                                  align="start"
                                  className="z-50 max-h-60 w-80 overflow-y-auto rounded-xl border border-slate-100 bg-white p-1 shadow-xl focus:outline-none"
                                >
                                  <div className="mb-1 border-b px-2.5 py-1 text-[9px] font-bold tracking-wider text-slate-400 uppercase">
                                    选择已有层级目录 (可点击匹配)
                                  </div>
                                  {getAutocompleteOptions(idx).length === 0 ? (
                                    <div className="text-muted-foreground px-3 py-2.5 text-xs italic">
                                      无匹配的已有同级层级，保存将创建新目录
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
                                            className="flex w-full animate-none items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition hover:bg-slate-50 hover:text-indigo-600"
                                          >
                                            <span>{opt}</span>
                                            <span className="py-0.2 shrink-0 rounded border border-emerald-100 bg-emerald-50 px-1 text-[9px] font-semibold text-emerald-600">
                                              已存
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
                                        className="w-full rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold text-indigo-600 transition hover:bg-indigo-50"
                                      >
                                        + 在此分支下新建: &quot;{lvl}&quot;
                                      </button>
                                    </div>
                                  )}
                                </PopoverContent>
                              </Popover>
                              <Edit3 className="pointer-events-none absolute top-1/2 right-2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
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
                                title="删除此级别"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            )}
                          </div>

                          {/* Match Status Badge */}
                          {lvl.trim() && (
                            <div className="flex items-center pl-[120px]">
                              {matchedNode ? (
                                <span className="animate-in fade-in slide-in-from-left-1 inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 backdrop-blur-sm duration-200">
                                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                                  ✓ 已成功匹配本地已存 &quot;{matchedNode.name}&quot;
                                </span>
                              ) : (
                                <span className="animate-in fade-in slide-in-from-left-1 inline-flex items-center gap-1 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium text-indigo-700 backdrop-blur-sm duration-200">
                                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
                                  {idx === levels.length - 1
                                    ? "+ 当前编辑节点的新名字"
                                    : "+ 将新建此层级节点"}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
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
                          LEVEL_PRESETS[levels.length] || `层级 ${levels.length + 1}`,
                        ]);
                      }}
                      className="mt-2 border-dashed border-indigo-200 text-xs text-indigo-600 hover:bg-indigo-50"
                    >
                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                      追加子级别 (Add Level)
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Section: Sub-nodes / Sub-chapters manager list */}
          {(!readOnly || children.length > 0) && (
            <div
              id="sub-chapters-list"
              className={cn(
                "border-border/80 bg-card scroll-mt-24 space-y-4 rounded-xl border p-6 shadow-sm transition-all duration-500",
                highlightSubChapters &&
                  "border-indigo-400 bg-indigo-50/10 shadow-lg ring-2 shadow-indigo-100/40 ring-indigo-500",
              )}
            >
              <div className="flex items-center justify-between border-b pb-2.5">
                <div>
                  <h3 className="text-foreground text-sm font-bold">
                    直属子章节目录 (Sub-chapters)
                  </h3>
                  <p className="text-muted-foreground mt-0.5 text-[11px]">
                    {readOnly
                      ? "当前章节下包含的单元或课次目录列表。点击可进入各章节进行查看。"
                      : "管理当前文件夹直接包含的单元或课次列表。支持行内快速重命名。"}
                  </p>
                </div>
                <span className="shrink-0 rounded bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-800">
                  共 {children.length} 个子节点
                </span>
              </div>

              <div className="space-y-2">
                {children.length === 0 ? (
                  <div className="rounded-lg border border-dashed bg-slate-50/50 py-8 text-center dark:bg-slate-900/10">
                    <FolderPlus className="mx-auto mb-1.5 h-6 w-6 text-slate-300" />
                    <p className="text-muted-foreground text-xs italic">
                      当前节点下暂无子章节或子课次
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-[10px]">
                      可以在下方快速输入名字进行新建
                    </p>
                  </div>
                ) : (
                  <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                    {children.map((child) => {
                      const ChildIcon = KIND_ICON[child.kind] ?? Bookmark;
                      return (
                        <div
                          key={child.id}
                          className="group flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/20 p-3 transition duration-150 hover:border-indigo-100 hover:bg-indigo-50/5"
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-3">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-100 bg-white text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-950">
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
                                        alert(`修改失败: ${res.error}`);
                                      }
                                    }
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.currentTarget.blur();
                                    }
                                  }}
                                  className="text-foreground w-full max-w-sm rounded border-b border-transparent bg-transparent px-1.5 py-0.5 text-sm font-semibold transition outline-none hover:border-slate-200 focus:border-indigo-500 focus:bg-white"
                                  placeholder="子章节名称"
                                />
                              )}
                              <span className="text-muted-foreground mt-0.5 block pl-1.5 text-[9px]">
                                {child.item_count} 个学习点 · {KIND_LABEL[child.kind] || "课次"}
                              </span>
                            </div>
                          </div>

                          <div className="ml-3 flex shrink-0 items-center gap-1.5">
                            <Link
                              href={`/parent/materials/${child.id}`}
                              className="flex h-7 items-center rounded border border-indigo-100 bg-indigo-50/50 px-2.5 text-[10px] font-semibold text-indigo-700 shadow-sm transition hover:bg-indigo-50"
                              title={readOnly ? "查看此章节详情" : "进入此章节编辑"}
                            >
                              {readOnly ? "查看" : "管理"}
                              <ArrowUpRight className="ml-0.5 h-3 w-3" />
                            </Link>
                            {!readOnly && (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => handleArchiveChild(child.id)}
                                className="text-muted-foreground hover:text-destructive shrink-0"
                                title="归档此子级"
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
                          ? "输入新单元名称 (如: Book 1)"
                          : group.kind === "textbook_unit"
                            ? "输入新课次名称 (如: Lesson 3)"
                            : "输入新子级节点名称"
                      }
                      disabled={addingChild}
                      className="bg-background border-border focus:ring-ring min-w-0 flex-1 rounded-lg border px-3 py-1.5 text-xs outline-none focus:ring-1"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      disabled={addingChild || !newChildName.trim()}
                      className="h-8 shrink-0 bg-indigo-50 px-3 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                    >
                      {addingChild ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <>
                          <Plus className="mr-1 h-3.5 w-3.5" />
                          快速添加
                        </>
                      )}
                    </Button>
                  </form>
                )}
              </div>
            </div>
          )}

          {/* Section: Core Learning Points Outline (only shown in View Mode for leaf nodes) */}
          {readOnly && children.length === 0 && (
            <div className="border-border/80 bg-card animate-in fade-in space-y-5 rounded-xl border p-6 shadow-sm duration-200">
              <div className="flex items-center justify-between border-b pb-3.5">
                <div>
                  <h3 className="text-foreground text-sm font-bold">
                    核心学习词汇与句式大纲 (Learning Outline)
                  </h3>
                  <p className="text-muted-foreground mt-0.5 text-[11px]">
                    当前课时节点包含的核心词汇、短语搭配以及核心句型模板。
                  </p>
                </div>
                <span className="shrink-0 rounded bg-indigo-50 px-2.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400">
                  共 {group.items.length} 个学习点
                </span>
              </div>

              {group.items.length === 0 ? (
                <div className="rounded-lg border border-dashed bg-slate-50/50 py-12 text-center dark:bg-slate-900/10">
                  <BookOpen className="mx-auto mb-2 h-7 w-7 animate-pulse text-slate-300" />
                  <p className="text-muted-foreground text-xs italic">
                    当前课时节点暂未添加具体学习词句
                  </p>
                  <p className="text-muted-foreground mt-1 text-[10px]">
                    点击上方 &quot;编辑教材&quot; 或前往详细词句管理进行添加
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* 1. Words */}
                  {itemsByType.word.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="flex items-center gap-1.5 pl-0.5 text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                        <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                        1. 核心词汇 ({itemsByType.word.length})
                      </h4>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {itemsByType.word.map((item, idx) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between rounded-lg border border-slate-100/80 bg-slate-50/30 px-3 py-2 text-xs"
                          >
                            <span className="font-bold text-slate-800 select-all dark:text-slate-200">
                              {item.text}
                            </span>
                            <div className="flex gap-1">
                              {item.pos && (
                                <span className="py-0.2 rounded border border-indigo-100/50 bg-indigo-50/50 px-1.5 text-[9px] leading-none font-medium text-indigo-600">
                                  {item.pos}
                                </span>
                              )}
                              {item.cefr_level && (
                                <span className="py-0.2 rounded border border-emerald-100/50 bg-emerald-50/50 px-1.5 text-[9px] leading-none font-medium text-emerald-600">
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
                      <h4 className="flex items-center gap-1.5 pl-0.5 text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        2. 常用短语 ({itemsByType.phrase.length})
                      </h4>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {itemsByType.phrase.map((item, idx) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between rounded-lg border border-slate-100/80 bg-slate-50/30 px-3 py-2 text-xs"
                          >
                            <span className="font-bold text-slate-800 select-all dark:text-slate-200">
                              {item.text}
                            </span>
                            {item.cefr_level && (
                              <span className="py-0.2 rounded border border-emerald-100/50 bg-emerald-50/50 px-1.5 text-[9px] leading-none font-medium text-emerald-600">
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
                      <h4 className="flex items-center gap-1.5 pl-0.5 text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        3. 核心句型 ({itemsByType.pattern.length})
                      </h4>
                      <div className="space-y-2">
                        {itemsByType.pattern.map((item, idx) => (
                          <div
                            key={idx}
                            className="space-y-1.5 rounded-lg border border-slate-100/80 bg-slate-50/30 p-3 text-xs"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-slate-800 select-all dark:text-slate-200">
                                {item.text}
                              </span>
                              {item.cefr_level && (
                                <span className="py-0.2 rounded border border-emerald-100/50 bg-emerald-50/50 px-1.5 text-[9px] leading-none font-medium text-emerald-600">
                                  {item.cefr_level}
                                </span>
                              )}
                            </div>
                            {item.anchor && (
                              <div className="flex items-center gap-1.5 rounded-md border border-slate-100 bg-white/60 px-2 py-1 text-[10px] text-slate-600 dark:bg-slate-950/20">
                                <span className="text-[8px] font-bold tracking-wide text-slate-400 uppercase">
                                  锚点定位:
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
            </div>
          )}
        </div>

        {/* Right Side: Learning Points Summary & Metadatas (Takes 1/3 width) */}
        <div className="space-y-6 lg:col-span-1">
          {/* Learning Points Overview Card */}
          <div className="border-border/80 bg-card space-y-4 rounded-xl border p-5 shadow-sm">
            <div className="flex flex-col items-start gap-1.5 border-b pb-2">
              <h3 className="text-foreground text-sm font-bold">重点词句掌握概况</h3>
              <span className="rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-0.5 text-[10px] font-semibold text-indigo-600 dark:border-indigo-950 dark:bg-indigo-950/30">
                {(() => {
                  const direct = group.items.length;
                  const total = descendantCounts.get(group.id) || direct;
                  // Lead with the meaningful number: a container node's own "0" is normal,
                  // not a deficiency, so it never takes the headline slot.
                  if (direct === 0 && total > 0) return `共 ${total} 个学习点 · 来自子章节`;
                  if (total > direct) return `本节 ${direct} 个 · 含子章节共 ${total} 个`;
                  return `共 ${direct} 个`;
                })()}
              </span>
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
                      <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4 text-center shadow-sm dark:border-indigo-900 dark:bg-indigo-950/20">
                        <span className="block text-2xl leading-none font-bold text-indigo-600 dark:text-indigo-400">
                          {total}
                        </span>
                        <span className="text-muted-foreground mt-1.5 block text-[10px] font-semibold">
                          个学习点 · 分布在子章节
                        </span>
                      </div>
                      <p className="text-muted-foreground pl-1 text-[10px] leading-relaxed italic">
                        💡 此章节本身不直接挂载词句，单词 / 短语 / 句型分项请进入子章节查看。
                      </p>
                    </div>
                  );
                }
                // Genuinely empty: no direct items and no descendants either.
                return (
                  <div className="rounded-xl border border-dashed bg-slate-50/50 py-8 text-center dark:bg-slate-900/10">
                    <BookOpen className="mx-auto mb-1.5 h-6 w-6 text-slate-300" />
                    <p className="text-muted-foreground text-xs italic">
                      {readOnly ? "此节点尚未录入任何词句" : "此节点未直接添加词句"}
                    </p>
                    <p className="text-muted-foreground mt-1 text-[10px]">
                      {readOnly
                        ? "可点击上方「编辑教材」进行添加"
                        : "请进入下方子章节录入，或在此直接补充"}
                    </p>
                  </div>
                );
              })()
            ) : (
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3 text-center dark:border-indigo-900 dark:bg-indigo-950/20">
                  <span className="block text-xl font-bold text-indigo-600 dark:text-indigo-400">
                    {itemsByType.word.length}
                  </span>
                  <span className="text-muted-foreground mt-0.5 block text-[9px] font-semibold">
                    单词
                  </span>
                </div>
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3 text-center dark:border-emerald-900 dark:bg-emerald-950/20">
                  <span className="block text-xl font-bold text-emerald-600 dark:text-emerald-400">
                    {itemsByType.phrase.length}
                  </span>
                  <span className="text-muted-foreground mt-0.5 block text-[9px] font-semibold">
                    短语
                  </span>
                </div>
                <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-3 text-center dark:border-amber-900 dark:bg-amber-950/20">
                  <span className="block text-xl font-bold text-amber-600 dark:text-amber-400">
                    {itemsByType.pattern.length}
                  </span>
                  <span className="text-muted-foreground mt-0.5 block text-[9px] font-semibold">
                    句型
                  </span>
                </div>
              </div>
            )}

            {/* Preview of items inside the book */}
            {group.items.length > 0 && (
              <div className="space-y-2 border-t pt-3">
                <span className="text-muted-foreground block text-[10px] font-bold tracking-wider uppercase">
                  学习点大纲预览
                </span>
                <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
                  {group.items.slice(0, 10).map((it, idx) => (
                    <span
                      key={idx}
                      className={cn(
                        "rounded border px-2 py-0.5 text-[10px] font-semibold",
                        it.type === "word"
                          ? "border-indigo-100 bg-indigo-50 text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/20 dark:text-indigo-400"
                          : it.type === "phrase"
                            ? "border-emerald-100 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-400"
                            : "border-amber-100 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-400",
                      )}
                    >
                      {it.text}
                    </span>
                  ))}
                  {group.items.length > 10 && (
                    <span className="text-muted-foreground self-center pl-1 text-[9px] font-medium">
                      +{group.items.length - 10} 更多...
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
                className="flex w-full items-center justify-center gap-1.5 bg-gradient-to-r from-indigo-600 to-violet-600 py-2 text-xs font-semibold text-white shadow-sm hover:from-indigo-700 hover:to-violet-700"
                size="sm"
              >
                <BookOpen className="h-3.5 w-3.5" />
                {readOnly ? "查看详细词汇与句式表 →" : "管理详细词汇与句式表 →"}
              </Button>
            </Link>
          </div>

          {/* Learner Assignment Card */}
          {learnerCount > 1 && (
            <div className="border-border/80 bg-card space-y-3 rounded-xl border p-5 shadow-sm">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-950/40">
                  <Users className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-foreground text-sm font-bold">学习者分配</p>
                  <p className="text-muted-foreground text-[11px]">
                    {rootGroup && rootGroup.id !== group.id
                      ? `此章节继承父级教材「${rootGroup.name}」的分配`
                      : "管理哪些孩子能看到此教材"}
                  </p>
                </div>
              </div>
              <Link
                href={`/parent/materials/${rootGroup ? rootGroup.id : group.id}/learners`}
                className="block w-full"
              >
                <Button
                  variant="outline"
                  className="w-full justify-center gap-1.5 border-violet-200 text-xs font-semibold text-violet-700 hover:bg-violet-50 hover:text-violet-800 dark:border-violet-800 dark:text-violet-400"
                  size="sm"
                >
                  <Users className="h-3.5 w-3.5" />
                  {rootGroup && rootGroup.id !== group.id
                    ? "管理父级教材分配 →"
                    : "管理 Learner 分配 →"}
                </Button>
              </Link>
            </div>
          )}

          {/* AI Prompts & Hints metadata Card */}
          {(!readOnly || sourceBookHint.trim() || promptNotes.trim()) && (
            <div className="border-border/80 bg-card space-y-4 rounded-xl border p-5 shadow-sm">
              <h3 className="text-foreground text-sm font-bold">教学元数据 (Metadata)</h3>

              {/* Source Book Hint */}
              {(!readOnly || sourceBookHint.trim()) && (
                <div className="space-y-1">
                  <label className="text-muted-foreground block text-[11px] font-semibold">
                    关联课本参考来源 (可为空)
                  </label>
                  {readOnly ? (
                    <div className="rounded-lg border border-slate-100 bg-slate-50/40 px-3 py-2 text-xs font-medium text-slate-700">
                      {sourceBookHint}
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={sourceBookHint}
                      onChange={(e) => setSourceBookHint(e.target.value)}
                      placeholder="例如: Oxford English 3A"
                      className="border-input bg-background focus:ring-ring w-full rounded-lg border px-3 py-1.5 text-xs outline-none focus:ring-1"
                    />
                  )}
                </div>
              )}

              {/* Prompt Notes */}
              {(!readOnly || promptNotes.trim()) && (
                <div className="space-y-1">
                  <label className="text-muted-foreground block text-[11px] font-semibold">
                    AI 专属教学提示词补充
                  </label>
                  {readOnly ? (
                    <div className="rounded-lg border border-slate-100 bg-slate-50/40 px-3 py-2 text-xs leading-relaxed font-medium whitespace-pre-wrap text-slate-700">
                      {promptNotes}
                    </div>
                  ) : (
                    <textarea
                      value={promptNotes}
                      onChange={(e) => setPromptNotes(e.target.value)}
                      placeholder="补充教学要点。例如：重点操练现在进行时、孩子发音不好时重点纠正 /r/ 发音。"
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
                    彻底删除此教材
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
