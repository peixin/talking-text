"use client";

import { useMemo, useState } from "react";
import { CornerDownRight, Inbox, Loader2, Plus, Sparkles, Tag, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FileItemBody, GroupOut, InboxOut, LanguageItemOut } from "@/lib/backend";
import { createGroup } from "../materials/actions";
import { dismissItem, fileItem, reloadWorkbench } from "./actions";

const CAPTURE_KIND = "quick_practice";

// The loose item the user has picked and is about to file into a tag node.
type Selected =
  | { kind: "capture"; groupId: string; item: LanguageItemOut }
  | { kind: "candidate"; text: string }
  | null;

type TreeNode = { group: GroupOut; children: TreeNode[] };

interface Props {
  initialInbox: InboxOut;
  groups: GroupOut[];
}

export function OrganizeWorkbenchClient({ initialInbox, groups: initialGroups }: Props) {
  const [inbox, setInbox] = useState<InboxOut>(initialInbox);
  const [groups, setGroups] = useState<GroupOut[]>(initialGroups);
  const [selected, setSelected] = useState<Selected>(null);
  const [newPath, setNewPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Canonical tag tree = everything except capture bags (those ARE the inbox).
  const tree = useMemo(() => {
    const canonical = groups.filter((g) => g.kind !== CAPTURE_KIND && !g.archived);
    const map = new Map<string, TreeNode>();
    canonical.forEach((g) => map.set(g.id, { group: g, children: [] }));
    const roots: TreeNode[] = [];
    canonical.forEach((g) => {
      const node = map.get(g.id)!;
      if (g.parent_id && map.has(g.parent_id)) map.get(g.parent_id)!.children.push(node);
      else roots.push(node);
    });
    return roots;
  }, [groups]);

  const bySource = useMemo(() => {
    const byBag = new Map<string, { name: string; items: LanguageItemOut[] }>();
    for (const ci of inbox.capture_items) {
      if (!byBag.has(ci.group_id)) byBag.set(ci.group_id, { name: ci.group_name, items: [] });
      byBag.get(ci.group_id)!.items.push(ci.item);
    }
    return byBag;
  }, [inbox.capture_items]);

  function removeSelected(prev: InboxOut, sel: NonNullable<Selected>): InboxOut {
    if (sel.kind === "capture") {
      return {
        ...prev,
        capture_items: prev.capture_items.filter(
          (ci) => !(ci.group_id === sel.groupId && ci.item.id === sel.item.id),
        ),
      };
    }
    return {
      ...prev,
      practice_candidates: prev.practice_candidates.filter((c) => c.text !== sel.text),
    };
  }

  function bodyFor(sel: NonNullable<Selected>, targetGroupId: string): FileItemBody {
    return sel.kind === "capture"
      ? { target_group_id: targetGroupId, item_id: sel.item.id, source_group_id: sel.groupId }
      : { target_group_id: targetGroupId, new_item: { text: sel.text, type: "word" } };
  }

  async function fileInto(targetGroupId: string) {
    if (!selected || busy) return;
    const sel = selected;
    setBusy(true);
    setError(null);
    const res = await fileItem(bodyFor(sel, targetGroupId));
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setInbox((prev) => removeSelected(prev, sel));
    setSelected(null);
  }

  async function dismiss(groupId: string, item: LanguageItemOut) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await dismissItem(groupId, item.id);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setInbox((prev) => ({
      ...prev,
      capture_items: prev.capture_items.filter(
        (ci) => !(ci.group_id === groupId && ci.item.id === item.id),
      ),
    }));
    if (selected?.kind === "capture" && selected.item.id === item.id) setSelected(null);
  }

  async function createPathAndMaybeFile() {
    const parts = newPath
      .split(/›|\/|>/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0 || busy) return;
    setBusy(true);
    setError(null);

    const created = await createGroup({
      name: parts[parts.length - 1],
      kind: "generic",
      items: [],
      tag_path: parts,
    });
    if (!created.ok) {
      setBusy(false);
      setError(created.error);
      return;
    }

    if (selected) {
      const sel = selected;
      const filed = await fileItem(bodyFor(sel, created.group.id));
      if (!filed.ok) {
        setBusy(false);
        setError(filed.error);
        return;
      }
      setInbox((prev) => removeSelected(prev, sel));
      setSelected(null);
    }

    // Re-sync the tree (tag_path may have created several ancestor nodes) + inbox.
    const reloaded = await reloadWorkbench();
    if (reloaded.ok) {
      setGroups(reloaded.groups);
      setInbox(reloaded.inbox);
    }
    setNewPath("");
    setBusy(false);
  }

  const looseCount = inbox.capture_items.length + inbox.practice_candidates.length;

  if (inbox.learner_id === null) {
    return (
      <p className="text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
        请先在顶部选择一个正在学习的 learner，再来整理素材。
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          操作失败：{error}
        </div>
      )}
      {selected && (
        <div className="flex items-center gap-2 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-sm text-indigo-800">
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CornerDownRight className="h-4 w-4" />
          )}
          已选中{" "}
          <strong>“{selected.kind === "capture" ? selected.item.text : selected.text}”</strong>
          —— 点击右侧任一标签节点即可归位
          <button
            onClick={() => setSelected(null)}
            className="ml-auto text-indigo-500 hover:text-indigo-700"
          >
            取消
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* ── Left: inbox ─────────────────────────────────────────────── */}
        <section className="border-border bg-card space-y-4 rounded-xl border p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Inbox className="h-4 w-4" /> 收件箱
            <span className="text-muted-foreground font-normal">({looseCount})</span>
          </h2>

          {/* Capture bags */}
          {bySource.size === 0 && inbox.practice_candidates.length === 0 && (
            <p className="text-muted-foreground py-6 text-center text-sm">
              收件箱空了 —— 所有散件都已归位 🎉
            </p>
          )}

          {[...bySource.entries()].map(([groupId, bag]) => (
            <div key={groupId} className="space-y-1.5">
              <div className="text-muted-foreground text-[11px] font-medium">
                采集袋 · {bag.name}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {bag.items.map((item) => {
                  const isSel = selected?.kind === "capture" && selected.item.id === item.id;
                  return (
                    <span
                      key={item.id}
                      className={cn(
                        "group inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition",
                        isSel
                          ? "border-indigo-500 bg-indigo-100 text-indigo-800"
                          : "border-border bg-background hover:border-indigo-300",
                      )}
                    >
                      <button onClick={() => setSelected({ kind: "capture", groupId, item })}>
                        {item.text}
                      </button>
                      <button
                        onClick={() => dismiss(groupId, item)}
                        title="从采集袋移除"
                        className="text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-red-500"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Practice-derived candidates */}
          {inbox.practice_candidates.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-muted-foreground flex items-center gap-1 text-[11px] font-medium">
                <Sparkles className="h-3 w-3" /> 练习里冒出的新词（孩子说过、还没收录）
              </div>
              <div className="flex flex-wrap gap-1.5">
                {inbox.practice_candidates.map((c) => {
                  const isSel = selected?.kind === "candidate" && selected.text === c.text;
                  return (
                    <button
                      key={c.text}
                      onClick={() => setSelected({ kind: "candidate", text: c.text })}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition",
                        isSel
                          ? "border-amber-500 bg-amber-100 text-amber-800"
                          : "border-border bg-background hover:border-amber-300",
                      )}
                    >
                      {c.text}
                      <span className="text-muted-foreground text-[10px]">×{c.count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* ── Right: canonical tag tree ───────────────────────────────── */}
        <section className="border-border bg-card space-y-3 rounded-xl border p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Tag className="h-4 w-4" /> 教材标签树
          </h2>

          {tree.length === 0 ? (
            <p className="text-muted-foreground py-2 text-xs">
              还没有教材结构。用下方输入框新建第一个标签路径。
            </p>
          ) : (
            <div className="space-y-0.5">
              {tree.map((node) => (
                <TreeRow
                  key={node.group.id}
                  node={node}
                  depth={0}
                  canFile={!!selected && !busy}
                  onFile={fileInto}
                />
              ))}
            </div>
          )}

          {/* Create a new tag-path node (and file the selection into it). */}
          <div className="border-border space-y-1.5 border-t pt-3">
            <label className="text-muted-foreground text-[11px] font-medium">
              新建标签路径（用 › 或 / 分隔，如 Tot Talk › Book 1 › Unit 1）
            </label>
            <div className="flex gap-2">
              <input
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                placeholder="Tot Talk › Book 1 › Unit 1"
                disabled={busy}
                className="bg-background border-border min-w-0 flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
              />
              <Button
                type="button"
                size="sm"
                onClick={createPathAndMaybeFile}
                disabled={busy || !newPath.trim()}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {selected ? "新建并归位" : "新建"}
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function TreeRow({
  node,
  depth,
  canFile,
  onFile,
}: {
  node: TreeNode;
  depth: number;
  canFile: boolean;
  onFile: (groupId: string) => void;
}) {
  return (
    <>
      <button
        onClick={() => canFile && onFile(node.group.id)}
        disabled={!canFile}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        className={cn(
          "flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-sm transition",
          canFile ? "cursor-pointer hover:bg-indigo-50 hover:text-indigo-700" : "cursor-default",
        )}
      >
        <span className="text-muted-foreground">{depth > 0 ? "›" : "▸"}</span>
        <span className="font-medium">{node.group.name}</span>
        {node.group.item_count > 0 && (
          <span className="text-muted-foreground text-[10px]">{node.group.item_count} 词</span>
        )}
      </button>
      {node.children.map((child) => (
        <TreeRow
          key={child.group.id}
          node={child}
          depth={depth + 1}
          canFile={canFile}
          onFile={onFile}
        />
      ))}
    </>
  );
}
