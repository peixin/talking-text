"use client";

import { useState, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { LessonEnrollDialog } from "@/components/LessonPickerClient";
import { AIPersonaSettingsClient } from "@/components/AIPersonaSettingsClient";
import { Link } from "@/i18n/routing";
import type { CurriculumSummary, LessonInfoOut, SyncPersonaBody } from "@/lib/backend";
import { addLesson, removeLesson, fetchCurriculumLessons, syncPersona } from "./actions";

interface Props {
  learnerId: string;
  learnerName: string;
  aiName: string;
  aiGender: string;
  aiPersonaPrompt: string | null;
  enrolledLessons: LessonInfoOut[];
  curricula: CurriculumSummary[];
}

export function LearnerSettingsClient({
  learnerId,
  learnerName,
  aiName,
  aiGender,
  aiPersonaPrompt,
  enrolledLessons,
  curricula,
}: Props) {
  const router = useRouter();
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const latestLesson = enrolledLessons[0];

  const handleEnroll = async (lessonIds: string[]) => {
    for (const id of lessonIds) {
      await addLesson(learnerId, id);
    }
  };

  const handleRemove = (lessonId: string) => {
    startTransition(async () => {
      await removeLesson(learnerId, lessonId);
    });
  };

  const handleStartPractice = () => {
    const params = latestLesson ? `?lessonId=${latestLesson.lesson_id}` : "";
    router.push(`/chat${params}`);
  };

  const handleSyncPersona = useCallback(
    (body: SyncPersonaBody) => syncPersona(learnerId, body),
    [learnerId]
  );

  return (
    <div className="mx-auto w-full max-w-lg space-y-6 px-4 py-8">
      <div className="mb-2 flex items-center gap-4">
        <Link href="/parent" className="text-muted-foreground hover:text-primary transition text-sm">
          ← 家长中心
        </Link>
      </div>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{learnerName}</h1>
        <Button onClick={handleStartPractice}>Start Practice →</Button>
      </div>

      <Separator />

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Lessons</h2>
          <Button variant="outline" size="sm" onClick={() => setEnrollOpen(true)}>
            + Add
          </Button>
        </div>

        {enrolledLessons.length === 0 && (
          <p className="text-muted-foreground text-sm">
            No lessons added yet. Click &quot;+ Add&quot; to browse the curriculum.
          </p>
        )}

        {enrolledLessons.map((l) => (
          <Card key={l.lesson_id} className="flex items-center justify-between p-3">
            <div className="space-y-0.5">
              <div className="text-sm font-medium">
                {l.curriculum_name} · {l.unit_number}
              </div>
              <div className="text-muted-foreground text-xs">
                {l.lesson_title ?? `Lesson ${l.lesson_sequence}`}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={isPending}
              onClick={() => handleRemove(l.lesson_id)}
              className="text-muted-foreground hover:text-destructive"
            >
              Remove
            </Button>
          </Card>
        ))}
      </div>

      <Separator />

      <AIPersonaSettingsClient
        initial={{ ai_name: aiName, ai_gender: aiGender, ai_persona_prompt: aiPersonaPrompt }}
        onSync={handleSyncPersona}
      />

      <LessonEnrollDialog
        open={enrollOpen}
        onOpenChange={setEnrollOpen}
        curricula={curricula}
        getLessons={fetchCurriculumLessons}
        onEnroll={handleEnroll}
      />
    </div>
  );
}
