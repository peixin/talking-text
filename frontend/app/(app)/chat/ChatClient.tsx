"use client";

type Message = { role: "user" | "assistant"; text: string };

export function ChatClient({ initialHistory }: { initialHistory: Message[] }) {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-xl font-medium">对话</h1>
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
