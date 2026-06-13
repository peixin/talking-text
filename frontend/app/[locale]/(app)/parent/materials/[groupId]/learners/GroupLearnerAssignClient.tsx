"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Users, Check, UserMinus, UserPlus, Loader2, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/Panel";
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
  const t = useTranslations("Materials");
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
        setErrorMsg(result.error ?? t("op_failed_retry"));
      }
      setPendingId(null);
    });
  }

  if (allLearners.length === 0) {
    return (
      <Panel className="border-border/80 p-10 text-center shadow-sm">
        <Users className="text-muted-foreground/50 mx-auto mb-3 h-10 w-10" />
        <p className="text-muted-foreground text-sm font-medium">{t("no_learners_title")}</p>
        <p className="text-muted-foreground mt-1 text-xs">{t("no_learners_hint")}</p>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats banner */}
      <Panel className="border-border/80 flex items-center gap-3 shadow-sm">
        <div className="bg-primary/5 text-primary flex h-9 w-9 items-center justify-center rounded-lg">
          <Users className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <p className="text-foreground text-sm font-bold">
            {t("learner_assign_for", { name: groupName })}
          </p>
          <p className="text-muted-foreground text-[11px]">
            {t("learner_assign_stats", { total: allLearners.length, assigned: assignedIds.size })}
          </p>
        </div>
        <Badge
          variant="outline"
          className="border-primary/20 bg-primary/5 h-auto gap-1.5 rounded-full px-3 py-1 font-normal"
        >
          <span className="text-primary text-lg font-extrabold">{assignedIds.size}</span>
          <span className="text-primary text-[10px]">/ {allLearners.length}</span>
        </Badge>
      </Panel>

      {/* Error */}
      {errorMsg && (
        <Alert variant="destructive" className="border-destructive/20 p-3">
          {errorMsg}
        </Alert>
      )}

      {/* Learner list */}
      <Panel className="border-border/80 divide-border/60 divide-y p-0 shadow-sm">
        {allLearners.map((learner) => {
          const isAssigned = assignedIds.has(learner.id);
          const isPending = pendingId === learner.id;

          return (
            <div
              key={learner.id}
              className={`flex items-center justify-between px-5 py-4 transition-colors duration-150 ${
                isAssigned ? "bg-success/5" : "hover:bg-muted/50"
              }`}
            >
              {/* Avatar + Name */}
              <div className="flex items-center gap-3.5">
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-colors ${
                    isAssigned
                      ? "bg-success shadow-success/30 text-white shadow-sm"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {learner.name.slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <p className="text-foreground text-sm font-semibold">{learner.name}</p>
                  <p className="text-muted-foreground mt-0.5 text-[11px]">
                    {isAssigned ? (
                      <span className="text-success flex items-center gap-1">
                        <Check className="h-3 w-3" />
                        {t("assigned_can_access")}
                      </span>
                    ) : (
                      t("unassigned_cannot_see")
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
                    ? "border-success/30 text-success hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                }`}
              >
                {isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : isAssigned ? (
                  <>
                    {/* Normal assigned state */}
                    <span className="inline-flex items-center group-hover:hidden">
                      <UserCheck className="mr-1.5 h-3.5 w-3.5" />
                      {t("assigned")}
                    </span>
                    {/* Hover unassign state */}
                    <span className="text-destructive hidden items-center group-hover:inline-flex">
                      <UserMinus className="mr-1.5 h-3.5 w-3.5" />
                      {t("unassign")}
                    </span>
                  </>
                ) : (
                  <>
                    <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                    {t("assign")}
                  </>
                )}
              </Button>
            </div>
          );
        })}
      </Panel>

      {/* Tip */}
      <p className="text-muted-foreground px-1 text-[11px]">{t("assign_tip")}</p>
    </div>
  );
}
