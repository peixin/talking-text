"use client";

import { useEffect, useMemo, useState } from "react";
import { FolderInput, Loader2, Sparkles, Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GroupOut, InboxBag, InboxCandidate, InboxOut } from "@/lib/backend";
import { createGroup } from "../materials/actions";
import { fileBag, reloadWorkbench, suggestBag } from "./actions";

const SEP = " › ";
const CAPTURE_KIND = "quick_practice";

function splitPath(s: string): string[] {
  return s
    .split(/›|\/|>/)
    .map((x) => x.trim())
    .filter(Boolean);
}

interface Props {
  initialInbox: InboxOut;
  groups: GroupOut[];
}

export function OrganizeWorkbenchClient({ initialInbox, groups: initialGroups }: Props) {
  const [bags, setBags] = useState<InboxBag[]>(initialInbox.capture_bags);
  const [candidates, setCandidates] = useState<InboxCandidate[]>(initialInbox.practice_candidates);
  const [groups, setGroups] = useState<GroupOut[]>(initialGroups);
  const [paths, setPaths] = useState<Record<string, string>>({}); // bag id → editable path
  const [suggesting, setSuggesting] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null); // bag id, or "candidates"
  const [candPath, setCandPath] = useState("");
  const [error, setError] = useState<string | null>(null);

  // AI pre-predicts a path for every bag on mount (default = bag name; AI refines
  // to reuse existing structure). The human just tweaks — ~80% done automatically.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const bag of initialInbox.capture_bags) {
        setSuggesting((s) => ({ ...s, [bag.group_id]: true }));
        const res = await suggestBag(bag.group_id);
        if (cancelled) return;
        setPaths((p) => ({
          ...p,
          [bag.group_id]: res.ok ? res.tag_path.join(SEP) : bag.name,
        }));
        setSuggesting((s) => ({ ...s, [bag.group_id]: false }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  const existingPaths = useMemo(() => {
    const canon = groups.filter((g) => g.kind !== CAPTURE_KIND && !g.archived);
    const byId = new Map(canon.map((g) => [g.id, g]));
    const pathOf = (g: GroupOut): string => {
      const names: string[] = [];
      let cur: GroupOut | undefined = g;
      const seen = new Set<string>();
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        names.unshift(cur.name);
        cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
      }
      return names.join(SEP);
    };
    return [...new Set(canon.map(pathOf))].sort();
  }, [groups]);

  async function syncFromServer() {
    const r = await reloadWorkbench();
    if (r.ok) {
      setGroups(r.groups);
      setBags(r.inbox.capture_bags);
      setCandidates(r.inbox.practice_candidates);
    }
  }

  async function doFileBag(bag: InboxBag) {
    const parts = splitPath(paths[bag.group_id] ?? bag.name);
    if (parts.length === 0) {
      setError("请先填写归位路径");
      return;
    }
    setBusy(bag.group_id);
    setError(null);
    const res = await fileBag(bag.group_id, parts);
    if (!res.ok) {
      setBusy(null);
      setError(res.error);
      return;
    }
    setBags((prev) => prev.filter((b) => b.group_id !== bag.group_id));
    await syncFromServer();
    setBusy(null);
  }

  async function fileAllCandidates() {
    const parts = splitPath(candPath);
    if (parts.length === 0) {
      setError("请先填写归位路径");
      return;
    }
    if (candidates.length === 0) return;
    setBusy("candidates");
    setError(null);
    const res = await createGroup({
      name: parts[parts.length - 1],
      kind: "generic",
      tag_path: parts,
      items: candidates.map((c) => ({ text: c.text, type: "word" as const })),
    });
    if (!res.ok) {
      setBusy(null);
      setError(res.error);
      return;
    }
    setCandidates([]);
    setCandPath("");
    await syncFromServer();
    setBusy(null);
  }

  if (initialInbox.learner_id === null) {
    return (
      <p className="text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
        请先在顶部选择一个正在学习的 learner，再来整理素材。
      </p>
    );
  }

  const nothingLeft = bags.length === 0 && candidates.length === 0;

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          操作失败：{error}
        </div>
      )}

      {existingPaths.length > 0 && (
        <details className="border-border bg-card/40 rounded-lg border px-3 py-2 text-xs">
          <summary className="text-muted-foreground cursor-pointer select-none">
            现有教材结构（{existingPaths.length} 条路径，可照抄标签名复用）
          </summary>
          <ul className="text-muted-foreground mt-2 space-y-0.5">
            {existingPaths.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </details>
      )}

      {nothingLeft && (
        <p className="text-muted-foreground rounded-xl border border-dashed p-10 text-center text-sm">
          收件箱空了 —— 所有素材都已归位 🎉
        </p>
      )}

      {/* ── Capture bags — one card per ingest, filed as a whole ─────────── */}
      {bags.map((bag) => {
        const isBusy = busy === bag.group_id;
        const isSuggesting = suggesting[bag.group_id];
        const preview = bag.items.slice(0, 14);
        return (
          <section
            key={bag.group_id}
            className="border-border bg-card space-y-3 rounded-xl border p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                <FolderInput className="h-4 w-4 text-indigo-500" />
                {bag.name}
                <span className="text-muted-foreground font-normal">· {bag.items.length} 词</span>
              </h3>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {preview.map((it) => (
                <span
                  key={it.id}
                  className="border-border bg-background inline-flex rounded-full border px-2.5 py-0.5 text-xs"
                >
                  {it.text}
                </span>
              ))}
              {bag.items.length > preview.length && (
                <span className="text-muted-foreground px-1 text-xs">
                  +{bag.items.length - preview.length}
                </span>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-muted-foreground flex items-center gap-1 text-[11px] font-medium">
                <Wand2 className="h-3 w-3 text-indigo-500" />
                归位到（AI 预判，可改 · 用 / 分隔层级）
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={paths[bag.group_id] ?? ""}
                  onChange={(e) => setPaths((p) => ({ ...p, [bag.group_id]: e.target.value }))}
                  disabled={isBusy}
                  placeholder={isSuggesting ? "AI 预判中…" : bag.name}
                  className={cn(
                    "bg-background border-border min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50",
                    isSuggesting && "animate-pulse",
                  )}
                />
                <Button
                  type="button"
                  onClick={() => doFileBag(bag)}
                  disabled={isBusy || isSuggesting}
                  className="w-full shrink-0 sm:w-auto"
                >
                  {isBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <FolderInput className="h-4 w-4" />
                  )}
                  整袋归位
                </Button>
              </div>
              {/* Tap to reuse an existing path — avoids typing on mobile. */}
              {existingPaths.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-muted-foreground text-[11px]">复用：</span>
                  {existingPaths.slice(0, 6).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPaths((prev) => ({ ...prev, [bag.group_id]: p }))}
                      className="border-border bg-background text-muted-foreground rounded-full border px-2.5 py-1 text-[11px] transition hover:border-indigo-300 hover:text-indigo-600"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>
        );
      })}

      {/* ── Practice-derived candidates — filed in bulk into one path ────── */}
      {candidates.length > 0 && (
        <section className="border-border bg-card space-y-3 rounded-xl border border-amber-200/60 p-4">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-amber-500" />
            练习里冒出的新词
            <span className="text-muted-foreground font-normal">
              · {candidates.length} 词（孩子说过、还没收录）
            </span>
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {candidates.slice(0, 30).map((c) => (
              <span
                key={c.text}
                className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs text-amber-800"
              >
                {c.text}
                <span className="text-[10px] opacity-60">×{c.count}</span>
              </span>
            ))}
            {candidates.length > 30 && (
              <span className="text-muted-foreground px-1 text-xs">+{candidates.length - 30}</span>
            )}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={candPath}
              onChange={(e) => setCandPath(e.target.value)}
              disabled={busy === "candidates"}
              placeholder="全部归位到，如 生词本 / 口语新词"
              className="bg-background border-border min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-amber-500 disabled:opacity-50"
            />
            <Button
              type="button"
              variant="outline"
              onClick={fileAllCandidates}
              disabled={busy === "candidates" || !candPath.trim()}
              className="w-full shrink-0 sm:w-auto"
            >
              {busy === "candidates" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FolderInput className="h-4 w-4" />
              )}
              全部归位
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
