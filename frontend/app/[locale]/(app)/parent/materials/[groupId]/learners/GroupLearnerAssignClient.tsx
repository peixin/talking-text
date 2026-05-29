"use client";

import { useState, useTransition } from "react";
import { Users, Check, UserMinus, UserPlus, Loader2, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LearnerOut } from "@/lib/backend";
import { assignLearnerAction, unassignLearnerAction } from "./actions";

interface Props {
  groupId: string;
  groupName: string;
  allLearners: LearnerOut[];
  initialAssignedIds: string[];
}

export function GroupLearnerAssignClient({
  groupId,
  groupName,
  allLearners,
  initialAssignedIds,
}: Props) {
  const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set(initialAssignedIds));
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function handleToggle(learner: LearnerOut) {
    const isAssigned = assignedIds.has(learner.id);
    setPendingId(learner.id);
    setErrorMsg(null);

    startTransition(async () => {
      let result: { ok: boolean; error?: string };
      if (isAssigned) {
        result = await unassignLearnerAction(groupId, learner.id);
        if (result.ok) {
          setAssignedIds((prev) => {
            const next = new Set(prev);
            next.delete(learner.id);
            return next;
          });
        }
      } else {
        result = await assignLearnerAction(groupId, learner.id);
        if (result.ok) {
          setAssignedIds((prev) => new Set([...prev, learner.id]));
        }
      }

      if (!result.ok) {
        setErrorMsg(result.error ?? "操作失败，请重试");
      }
      setPendingId(null);
    });
  }

  if (allLearners.length === 0) {
    return (
      <div className="border-border/80 bg-card rounded-xl border p-10 text-center shadow-sm">
        <Users className="mx-auto mb-3 h-10 w-10 text-slate-300" />
        <p className="text-muted-foreground text-sm font-medium">当前账户下暂无孩子档案</p>
        <p className="text-muted-foreground mt-1 text-xs">
          请先在「孩子管理」中添加孩子档案，再回来分配教材。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats banner */}
      <div className="border-border/80 bg-card flex items-center gap-3 rounded-xl border p-4 shadow-sm">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40">
          <Users className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <p className="text-foreground text-sm font-bold">「{groupName}」的学习者分配</p>
          <p className="text-muted-foreground text-[11px]">
            共 {allLearners.length} 个孩子档案 · 已分配 {assignedIds.size} 人
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 dark:border-indigo-900 dark:bg-indigo-950/30">
          <span className="text-lg font-extrabold text-indigo-600">{assignedIds.size}</span>
          <span className="text-[10px] text-indigo-500">/ {allLearners.length}</span>
        </div>
      </div>

      {/* Error */}
      {errorMsg && (
        <div className="border-destructive/20 bg-destructive/10 text-destructive rounded-lg border p-3 text-sm">
          {errorMsg}
        </div>
      )}

      {/* Learner list */}
      <div className="border-border/80 bg-card divide-border/60 divide-y rounded-xl border shadow-sm">
        {allLearners.map((learner) => {
          const isAssigned = assignedIds.has(learner.id);
          const isPending = pendingId === learner.id;

          return (
            <div
              key={learner.id}
              className={`flex items-center justify-between px-5 py-4 transition-colors duration-150 ${
                isAssigned
                  ? "bg-emerald-50/40 dark:bg-emerald-950/10"
                  : "hover:bg-slate-50/60 dark:hover:bg-slate-900/10"
              }`}
            >
              {/* Avatar + Name */}
              <div className="flex items-center gap-3.5">
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-colors ${
                    isAssigned
                      ? "bg-emerald-500 text-white shadow-sm shadow-emerald-200"
                      : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                  }`}
                >
                  {learner.name.slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <p className="text-foreground text-sm font-semibold">{learner.name}</p>
                  <p className="text-muted-foreground mt-0.5 text-[11px]">
                    {isAssigned ? (
                      <span className="flex items-center gap-1 text-emerald-600">
                        <Check className="h-3 w-3" />
                        已分配，可访问此教材
                      </span>
                    ) : (
                      "暂未分配，无法看到此教材"
                    )}
                  </p>
                </div>
              </div>

              {/* Toggle button */}
              <Button
                size="sm"
                variant={isAssigned ? "outline" : "default"}
                onClick={() => handleToggle(learner)}
                disabled={isPending}
                className={`group h-8 min-w-[100px] shrink-0 text-xs font-semibold transition-all ${
                  isAssigned
                    ? "border-emerald-200 text-emerald-700 hover:border-red-200 hover:bg-red-50 hover:text-red-600 dark:border-emerald-800 dark:text-emerald-400"
                    : "bg-indigo-600 text-white hover:bg-indigo-700"
                }`}
              >
                {isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : isAssigned ? (
                  <>
                    {/* Normal assigned state */}
                    <span className="inline-flex items-center group-hover:hidden">
                      <UserCheck className="mr-1.5 h-3.5 w-3.5" />
                      已分配
                    </span>
                    {/* Hover unassign state */}
                    <span className="hidden items-center text-red-600 group-hover:inline-flex">
                      <UserMinus className="mr-1.5 h-3.5 w-3.5" />
                      取消分配
                    </span>
                  </>
                ) : (
                  <>
                    <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                    分配
                  </>
                )}
              </Button>
            </div>
          );
        })}
      </div>

      {/* Tip */}
      <p className="text-muted-foreground px-1 text-[11px]">
        💡 分配后孩子的学习库将立即更新。取消分配后孩子无法再看到此教材，但教材内容本身不受影响。
      </p>
    </div>
  );
}
