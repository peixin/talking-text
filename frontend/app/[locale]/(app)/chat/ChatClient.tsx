"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { LearnerOut } from "@/lib/backend";
import { setActiveLearner } from "./actions";

type Message = { role: "user" | "assistant"; text: string };

export function ChatClient({ 
  initialHistory, 
  activeLearner,
  learners
}: { 
  initialHistory: Message[];
  activeLearner: LearnerOut;
  learners: LearnerOut[];
}) {
  const t = useTranslations("Chat");

  // Automatically sync active learner to backend on mount
  useEffect(() => {
    setActiveLearner(activeLearner.id);
  }, [activeLearner.id]);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-xl font-medium">{t("title")}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t("welcome", { name: activeLearner.name })}</p>
        </div>
        
        {learners.length > 1 && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t("current_child")}</span>
            <select 
              value={activeLearner.id}
              onChange={(e) => {
                setActiveLearner(e.target.value).then(() => {
                  window.location.reload();
                });
              }}
              className="border-border bg-background rounded border px-2 py-1 focus:outline-none"
            >
              {learners.map(l => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      
      <div className="text-muted-foreground">
        {initialHistory.length === 0
          ? t("no_chat")
          : t("history_count", { count: initialHistory.length })}
      </div>
    </div>
  );
}
