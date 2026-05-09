"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import type { CurriculumLessonsOut, LessonInfoOut } from "@/lib/backend";

// ── Enroll mode ──────────────────────────────────────────────────────────────

interface EnrollModeProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  curricula: { id: string; name: string; publisher: string | null }[];
  getLessons: (curriculumId: string) => Promise<CurriculumLessonsOut>;
  onEnroll: (lessonIds: string[]) => Promise<void>;
}

export function LessonEnrollDialog({
  open,
  onOpenChange,
  curricula,
  getLessons,
  onEnroll,
}: EnrollModeProps) {
  const [selectedCurriculumId, setSelectedCurriculumId] = useState<string | null>(null);
  const [lessonsData, setLessonsData] = useState<CurriculumLessonsOut | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (selectedCurriculumId) {
      getLessons(selectedCurriculumId).then(setLessonsData);
    }
  }, [selectedCurriculumId, getLessons]);

  const toggle = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  const handleSave = () => {
    if (selectedIds.size === 0) return;
    startTransition(async () => {
      await onEnroll([...selectedIds]);
      setSelectedIds(new Set());
      onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Lessons</DialogTitle>
        </DialogHeader>

        {!selectedCurriculumId ? (
          <div className="space-y-2">
            {curricula.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedCurriculumId(c.id)}
                className="hover:bg-accent w-full rounded-md border p-3 text-left transition"
              >
                <div className="font-medium">{c.name}</div>
                {c.publisher && (
                  <div className="text-muted-foreground text-sm">{c.publisher}</div>
                )}
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            <button
              onClick={() => {
                setSelectedCurriculumId(null);
                setLessonsData(null);
              }}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm"
            >
              ← Back
            </button>
            {lessonsData?.units.map((unit) => (
              <Collapsible key={unit.id} defaultOpen>
                <CollapsibleTrigger className="flex w-full items-center justify-between py-1 font-medium">
                  <span>
                    {unit.unit_number} — {unit.title}
                  </span>
                  <span className="text-muted-foreground text-xs">▾</span>
                </CollapsibleTrigger>
                <CollapsibleContent className="ml-4 space-y-1 pt-1">
                  {unit.lessons.map((lesson) => (
                    <label
                      key={lesson.id}
                      className="flex cursor-pointer items-center gap-3 rounded py-1"
                    >
                      <Checkbox
                        checked={selectedIds.has(lesson.id)}
                        onCheckedChange={() => toggle(lesson.id)}
                      />
                      <span className="text-sm">
                        {lesson.title ?? `Lesson ${lesson.sequence}`}
                      </span>
                    </label>
                  ))}
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        )}

        <Separator />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={selectedIds.size === 0 || isPending}>
            {isPending
              ? "Saving…"
              : `Add ${selectedIds.size} lesson${selectedIds.size !== 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Switch mode ───────────────────────────────────────────────────────────────

interface SwitchModeProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  enrolledLessons: LessonInfoOut[];
  currentLessonId?: string | null;
  onSelect: (lessonId: string) => void;
}

export function LessonSwitchDialog({
  open,
  onOpenChange,
  enrolledLessons,
  currentLessonId,
  onSelect,
}: SwitchModeProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Choose a Lesson</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          {enrolledLessons.length === 0 && (
            <p className="text-muted-foreground text-sm">
              No lessons added yet. Go to the learner home page to add lessons.
            </p>
          )}
          {enrolledLessons.map((l) => {
            const isCurrent = l.lesson_id === currentLessonId;
            return (
              <button
                key={l.lesson_id}
                disabled={isCurrent}
                onClick={() => {
                  onSelect(l.lesson_id);
                  onOpenChange(false);
                }}
                className={
                  isCurrent
                    ? "w-full rounded-md border p-3 text-left opacity-60 cursor-not-allowed bg-muted"
                    : "hover:bg-accent w-full rounded-md border p-3 text-left transition"
                }
              >
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">
                    {l.curriculum_name} · {l.unit_number}
                  </div>
                  {isCurrent && (
                    <span className="text-xs font-medium text-primary bg-primary/10 rounded px-2 py-0.5">
                      Current
                    </span>
                  )}
                </div>
                <div className="text-muted-foreground text-xs">
                  {l.lesson_title ?? `Lesson ${l.lesson_sequence}`}
                </div>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
