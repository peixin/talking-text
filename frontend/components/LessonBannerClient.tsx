"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScopeSwitchDialog } from "@/components/LessonPickerClient";
import type { LessonInfoOut, CollectionOut } from "@/lib/backend";

interface Props {
  sessionId: string;
  currentLesson: LessonInfoOut | null;
  currentCollection: CollectionOut | null;
  enrolledLessons: LessonInfoOut[];
  collections: CollectionOut[];
  onLessonChange: (lessonId: string) => Promise<void>;
  onCollectionChange: (collectionId: string) => Promise<void>;
}

export function ScopeBannerClient({
  currentLesson,
  currentCollection,
  enrolledLessons,
  collections,
  onLessonChange,
  onCollectionChange,
}: Props) {
  const [switchOpen, setSwitchOpen] = useState(false);

  const handleSelectLesson = (lessonId: string) => {
    void onLessonChange(lessonId);
  };

  const handleSelectCollection = (collectionId: string) => {
    void onCollectionChange(collectionId);
  };

  if (!currentLesson && !currentCollection) {
    return (
      <>
        <div className="border-b bg-amber-50 px-4 py-2 text-sm dark:bg-amber-950">
          <span className="text-amber-700 dark:text-amber-300">📚 No topic selected — </span>
          <button
            onClick={() => setSwitchOpen(true)}
            className="font-medium text-amber-800 underline underline-offset-2 dark:text-amber-200"
          >
            select today&apos;s topic
          </button>
          <span className="text-muted-foreground ml-2 text-xs">
            (or chat freely)
          </span>
        </div>
        <ScopeSwitchDialog
          open={switchOpen}
          onOpenChange={setSwitchOpen}
          enrolledLessons={enrolledLessons}
          collections={collections}
          currentLessonId={null}
          currentCollectionId={null}
          onSelectLesson={handleSelectLesson}
          onSelectCollection={handleSelectCollection}
        />
      </>
    );
  }

  return (
    <>
      <div className="border-b bg-muted/40 flex items-center gap-3 px-4 py-2">
        <span className="text-sm">{currentLesson ? "📚" : "🔖"}</span>
        <div className="flex flex-1 items-center gap-2 text-sm">
          {currentLesson ? (
            <>
              <span className="font-medium">{currentLesson.curriculum_name}</span>
              <Badge variant="secondary" className="text-xs">
                {currentLesson.unit_number}
              </Badge>
              <span className="text-muted-foreground">
                · {currentLesson.lesson_title ?? `Lesson ${currentLesson.lesson_sequence}`}
              </span>
            </>
          ) : currentCollection ? (
            <>
              <span className="font-medium">{currentCollection.name}</span>
              <span className="text-muted-foreground">· Collection</span>
            </>
          ) : null}
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
      <ScopeSwitchDialog
        open={switchOpen}
        onOpenChange={setSwitchOpen}
        enrolledLessons={enrolledLessons}
        collections={collections}
        currentLessonId={currentLesson?.lesson_id ?? null}
        currentCollectionId={currentCollection?.id ?? null}
        onSelectLesson={handleSelectLesson}
        onSelectCollection={handleSelectCollection}
      />
    </>
  );
}
