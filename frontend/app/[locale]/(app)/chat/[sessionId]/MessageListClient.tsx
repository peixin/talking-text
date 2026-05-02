"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Play, Square } from "lucide-react";

import { Message } from "./actions";

export type AudioState = {
  playingTurnId: string | null;
  playingDir: "in" | "out" | null;
  loadingKey: string | null; // "<turnId>:<dir>"
};

interface Props {
  messages: Message[];
  sessionId: string;
  audioState: AudioState;
  onPlay: (turnId: string, dir: "in" | "out") => void;
}

function PlayButton({
  turnId,
  dir,
  audioState,
  onPlay,
  title,
}: {
  turnId: string;
  dir: "in" | "out";
  audioState: AudioState;
  onPlay: (turnId: string, dir: "in" | "out") => void;
  title: string;
}) {
  const key = `${turnId}:${dir}`;
  const isLoading = audioState.loadingKey === key;
  const isPlaying = audioState.playingTurnId === turnId && audioState.playingDir === dir;

  return (
    <button
      onClick={() => onPlay(turnId, dir)}
      disabled={isLoading}
      className="mb-1 shrink-0 text-muted-foreground transition hover:text-foreground disabled:opacity-40"
      title={title}
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin pointer-events-none" />
      ) : isPlaying ? (
        <Square className="h-4 w-4 fill-current pointer-events-none" />
      ) : (
        <Play className="h-4 w-4 pointer-events-none" />
      )}
    </button>
  );
}

export function MessageListClient({ messages, sessionId: _sessionId, audioState, onPlay }: Props) {
  const t = useTranslations("Chat");
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground text-center text-sm">{t("no_chat")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
      {messages.map((m, i) => (
        <div
          key={i}
          className={
            m.role === "user"
              ? "self-end flex max-w-[75%] items-end gap-2"
              : "self-start flex max-w-[75%] items-end gap-2"
          }
        >
          {m.role === "assistant" ? (
            <>
              <div className="rounded-2xl bg-muted px-4 py-2 min-w-[2rem]">
                {m.streaming && !m.text ? (
                  <span className="flex items-center gap-1 py-0.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:0ms]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:300ms]" />
                  </span>
                ) : (
                  <>
                    {m.text}
                    {m.streaming && (
                      <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-current align-text-bottom" />
                    )}
                  </>
                )}
              </div>
              {m.turnId && !m.streaming && (
                <PlayButton
                  turnId={m.turnId}
                  dir="out"
                  audioState={audioState}
                  onPlay={onPlay}
                  title={t("play_audio")}
                />
              )}
            </>
          ) : (
            <>
              {/* Input play button: only for voice turns once committed */}
              {m.turnId && !m.pending && m.inputMode !== "text" && (
                <PlayButton
                  turnId={m.turnId}
                  dir="in"
                  audioState={audioState}
                  onPlay={onPlay}
                  title={t("play_audio")}
                />
              )}
              <div className="rounded-2xl bg-primary px-4 py-2 text-primary-foreground">
                {m.pending ? (
                  <span className="flex items-center gap-1.5 opacity-70">
                    <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                    {t("transcribing")}
                  </span>
                ) : (
                  m.text
                )}
              </div>
            </>
          )}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
