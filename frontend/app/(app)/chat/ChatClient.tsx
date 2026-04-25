"use client";

import { useEffect } from "react";
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
  // Automatically save the selected active learner to cookie if not already set, 
  // or just ensure the server state is sync'd when component mounts
  useEffect(() => {
    setActiveLearner(activeLearner.id);
  }, [activeLearner.id]);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-xl font-medium">对话</h1>
          <p className="text-muted-foreground mt-1 text-sm">你好，{activeLearner.name}！准备好开始今天的学习了吗？</p>
        </div>
        
        {learners.length > 1 && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">当前孩子：</span>
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
          ? "还没有对话。按住下方按钮开始说话。"
          : `历史 ${initialHistory.length} 条`}
      </div>
      <div className="text-muted-foreground mt-8 text-sm">
        TODO: MediaRecorder + POST /conversation/turn + 音频播放
      </div>
    </div>
  );
}
