"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArrowUpRight,
  BookOpen,
  Bookmark,
  FolderPlus,
  Loader2,
  MessageSquare,
  Plus,
  Save,
  Sparkles,
  Trash2,
  X,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import type { GroupDetailOut, GroupOut, ItemType } from "@/lib/backend";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  let curr: GroupOut | undefined = groups.find((g) => g.id === currentGroupId);
  while (curr) {
    path.unshift(curr.name);
    const pid: string | null = curr.parent_id;
    if (!pid) break;
    curr = groups.find((g) => g.id === pid);
  }
  return path;
}

export function GroupDetailClient({ group, allGroups }: Props) {
  const router = useRouter();

  // Core visual states
  const [groupName, setGroupName] = useState(group.name);
  const [groupsLocalState, setGroupsLocalState] = useState<GroupOut[]>(allGroups);

  // Compute hierarchy paths dynamically based on updated tree
  const initialLevels = useMemo(
    () => computePathLevels(group.id, groupsLocalState),
    [group.id, groupsLocalState],
  );
  const [levels, setLevels] = useState<string[]>(
    initialLevels.length > 0 ? initialLevels : ["未分类教材"],
  );

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
      levels: levels.map((lvl) => lvl.trim()).filter(Boolean),
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

      {/* Floating Toolbar */}
      <div className="border-border/80 bg-background/90 sticky top-14 z-10 flex flex-col justify-between gap-3 rounded-xl border p-4 shadow-md backdrop-blur-md sm:flex-row sm:items-center sm:gap-4">
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
        </div>
      </div>

      {/* Main double column workspace */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left Side: Hierarchy breadcrumb path and Sub-nodes list (Takes 2/3 width) */}
        <div className="space-y-6 lg:col-span-2">
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
              <h3 className="text-foreground text-sm font-bold">教材归属层级关联 (Levels Path)</h3>
              <p className="text-muted-foreground mt-0.5 text-[11px]">
                指定当前内容在整个教材库中的层级归属。宽度经过拓宽，长书名一览无余。
              </p>
            </div>

            <div className="space-y-3 rounded-xl border border-indigo-500/10 bg-indigo-500/5 p-4">
              <label className="block pl-1 text-[10px] font-bold tracking-wider text-indigo-800 uppercase">
                层级深度序列（由根部至叶子）
              </label>

              <div className="space-y-2.5">
                {levels.map((lvl, idx) => {
                  const matchedNode = getMatchedGroupNode(idx);
                  return (
                    <div
                      key={idx}
                      className="w-full min-w-0 space-y-1.5 rounded-xl border border-slate-100/80 bg-white/60 p-3 shadow-sm dark:border-slate-800/40 dark:bg-slate-950/20"
                    >
                      <div className="flex w-full min-w-0 items-center gap-2">
                        {/* Level badge label */}
                        <span className="shrink-0 rounded border border-indigo-100 bg-indigo-50 px-2 py-1 text-[10px] font-semibold text-indigo-700 dark:border-indigo-950 dark:bg-indigo-950/40 dark:text-indigo-400">
                          Level {idx + 1}
                        </span>

                        {/* Autocomplete Input leveraging shadcn Popover */}
                        <div className="min-w-0 flex-1">
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
                                  setLevels((prev) => prev.map((x, i) => (i === idx ? val : x)));
                                  setActivePopoverIdx(idx);
                                }}
                                onFocus={() => setActivePopoverIdx(idx)}
                                disabled={saving}
                                placeholder={`输入级别名称，如 Book 1 / Unit 2...`}
                                className="bg-background border-border w-full rounded-lg border px-3 py-1.5 text-sm font-medium outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
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
                                    .filter((opt) => opt.toLowerCase().includes(lvl.toLowerCase()))
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
                                        className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition hover:bg-slate-50 hover:text-indigo-600"
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
                        </div>

                        {/* Delete action button */}
                        {levels.length > 1 && !saving && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => {
                              setLevels((prev) => prev.filter((_, i) => i !== idx));
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
                        <div className="flex items-center pl-[66px]">
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
                  }}
                  className="mt-2 border-dashed border-indigo-200 text-xs text-indigo-600 hover:bg-indigo-50"
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  追加子级别 (Add Level)
                </Button>
              )}
            </div>
          </div>

          {/* Section: Sub-nodes / Sub-chapters manager list */}
          <div className="border-border/80 bg-card space-y-4 rounded-xl border p-6 shadow-sm">
            <div className="flex items-center justify-between border-b pb-2.5">
              <div>
                <h3 className="text-foreground text-sm font-bold">直属子章节目录 (Sub-chapters)</h3>
                <p className="text-muted-foreground mt-0.5 text-[11px]">
                  管理当前文件夹直接包含的单元或课次列表。支持行内快速重命名。
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
                            {/* Inline rename input trigger onBlur or Enter */}
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
                            <span className="text-muted-foreground mt-0.5 block pl-1.5 text-[9px]">
                              {child.item_count} 个学习点 · {KIND_LABEL[child.kind] || "课次"}
                            </span>
                          </div>
                        </div>

                        <div className="ml-3 flex shrink-0 items-center gap-1.5">
                          <Link
                            href={`/parent/materials/${child.id}`}
                            className="flex h-7 items-center rounded border border-slate-200 bg-white px-2 text-[10px] font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                            title="进入此章节编辑"
                          >
                            管理
                            <ArrowUpRight className="ml-0.5 h-3 w-3" />
                          </Link>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleArchiveChild(child.id)}
                            className="text-muted-foreground hover:text-destructive shrink-0"
                            title="归档此子级"
                          >
                            <Archive className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Quick Add Child Form */}
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
            </div>
          </div>
        </div>

        {/* Right Side: Learning Points Summary & Metadatas (Takes 1/3 width) */}
        <div className="space-y-6 lg:col-span-1">
          {/* Learning Points Overview Card */}
          <div className="border-border/80 bg-card space-y-4 rounded-xl border p-5 shadow-sm">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="text-foreground text-sm font-bold">重点词句掌握概况</h3>
              <span className="shrink-0 rounded-full border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-600">
                共 {group.items.length} 个
              </span>
            </div>

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
                管理详细词汇与句式表 →
              </Button>
            </Link>
          </div>

          {/* AI Prompts & Hints metadata Card */}
          <div className="border-border/80 bg-card space-y-4 rounded-xl border p-5 shadow-sm">
            <h3 className="text-foreground text-sm font-bold">教学元数据 (Metadata)</h3>

            {/* Source Book Hint */}
            <div className="space-y-1">
              <label className="text-muted-foreground block text-[11px] font-semibold">
                关联课本参考来源 (可为空)
              </label>
              <input
                type="text"
                value={sourceBookHint}
                onChange={(e) => setSourceBookHint(e.target.value)}
                placeholder="例如: Oxford English 3A"
                className="border-input bg-background focus:ring-ring w-full rounded-lg border px-3 py-1.5 text-xs outline-none focus:ring-1"
              />
            </div>

            {/* Prompt Notes */}
            <div className="space-y-1">
              <label className="text-muted-foreground block text-[11px] font-semibold">
                AI 专属教学提示词补充
              </label>
              <textarea
                value={promptNotes}
                onChange={(e) => setPromptNotes(e.target.value)}
                placeholder="补充教学要点。例如：重点操练现在进行时、孩子发音不好时重点纠正 /r/ 发音。"
                rows={4}
                className="border-input bg-background focus:ring-ring w-full resize-none rounded-lg border px-3 py-2 text-xs outline-none focus:ring-1"
              />
            </div>

            {/* Delete Danger Zone */}
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
          </div>
        </div>
      </div>
    </div>
  );
}
