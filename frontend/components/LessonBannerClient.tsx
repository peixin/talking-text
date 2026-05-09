"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LessonSwitchDialog } from "@/components/LessonPickerClient";
import type { LessonInfoOut } from "@/lib/backend";

interface Props {
  sessionId: string;
  currentLesson: LessonInfoOut | null;
  enrolledLessons: LessonInfoOut[];
  onLessonChange: (lessonId: string) => Promise<void>;
}

export function LessonBannerClient({
  currentLesson,
  enrolledLessons,
  onLessonChange,
}: Props) {
  const [switchOpen, setSwitchOpen] = useState(false);

  // LessonSwitchDialog.onSelect is (lessonId: string) => void,
  // so we fire-and-forget the async handler.
  const handleSelect = (lessonId: string) => {
    void onLessonChange(lessonId);
  };

  if (!currentLesson) {
    return (
      <>
        <div className="border-b bg-amber-50 px-4 py-2 text-sm dark:bg-amber-950">
          <span className="text-amber-700 dark:text-amber-300">📚 No lesson selected — </span>
          <button
            onClick={() => setSwitchOpen(true)}
            className="font-medium text-amber-800 underline underline-offset-2 dark:text-amber-200"
          >
            select today&apos;s lesson
          </button>
          <span className="text-muted-foreground ml-2 text-xs">
            (or chat freely without a lesson)
          </span>
        </div>
        <LessonSwitchDialog
          open={switchOpen}
          onOpenChange={setSwitchOpen}
          enrolledLessons={enrolledLessons}
          currentLessonId={null}
          onSelect={handleSelect}
        />
      </>
    );
  }

  return (
    <>
      <div className="border-b bg-muted/40 flex items-center gap-3 px-4 py-2">
        <span className="text-sm">📚</span>
        <div className="flex flex-1 items-center gap-2 text-sm">
          <span className="font-medium">{currentLesson.curriculum_name}</span>
          <Badge variant="secondary" className="text-xs">
            {currentLesson.unit_number}
          </Badge>
          <span className="text-muted-foreground">
            · {currentLesson.lesson_title ?? `Lesson ${currentLesson.lesson_sequence}`}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground text-xs"
          onClick={() => setSwitchOpen(true)}
        >
          Switch
        </Button>
      </div>
      <LessonSwitchDialog
        open={switchOpen}
        onOpenChange={setSwitchOpen}
        enrolledLessons={enrolledLessons}
        currentLessonId={currentLesson.lesson_id}
        onSelect={handleSelect}
      />
    </>
  );
}
