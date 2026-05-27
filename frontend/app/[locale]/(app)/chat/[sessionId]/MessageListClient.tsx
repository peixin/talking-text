"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Camera, BookOpen, Loader2, Play, Sparkles, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { IngestTrigger } from "./IngestDrawerClient";

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
  activeLearnerName?: string;
  currentGroupId?: string | null;
  onOpenIngest?: (trigger: IngestTrigger) => void;
  onOpenScopeSwitcher?: () => void;
  onboardingDismissed?: boolean;
  onDismissOnboarding?: () => void;
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
      className="text-muted-foreground hover:text-foreground mb-1 shrink-0 transition disabled:opacity-40"
      title={title}
    >
      {isLoading ? (
        <Loader2 className="pointer-events-none h-4 w-4 animate-spin" />
      ) : isPlaying ? (
        <Square className="pointer-events-none h-4 w-4 fill-current" />
      ) : (
        <Play className="pointer-events-none h-4 w-4" />
      )}
    </button>
  );
}

export function MessageListClient({
  messages,
  audioState,
  onPlay,
  activeLearnerName,
  currentGroupId,
  onOpenIngest,
  onOpenScopeSwitcher,
  onboardingDismissed,
  onDismissOnboarding,
}: Props) {
  const t = useTranslations("Chat");
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const showOnboarding = messages.length === 0 && currentGroupId === null && !onboardingDismissed;

  if (messages.length === 0 && !showOnboarding) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground text-center text-sm">{t("no_chat")}</p>
      </div>
    );
  }

  if (showOnboarding) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto p-6">
        <div className="bg-card/60 relative w-full max-w-lg overflow-hidden rounded-2xl border border-indigo-500/10 p-6 shadow-xl backdrop-blur-md transition-all duration-500 hover:shadow-indigo-500/5">
          {/* Close button */}
          <button
            type="button"
            onClick={onDismissOnboarding}
            className="text-muted-foreground/60 hover:text-foreground hover:bg-muted absolute top-4 right-4 rounded-full p-1 transition"
            aria-label={t("close")}
          >
            <X className="h-4 w-4" />
          </button>

          {/* Assistant Header / Logo */}
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 animate-pulse items-center justify-center rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-600 text-white shadow-md shadow-indigo-500/20">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold tracking-tight">Tina</h3>
              <p className="text-muted-foreground text-xs font-medium">AI English Coach</p>
            </div>
          </div>

          {/* Welcome Text */}
          <p className="text-foreground/90 mb-6 text-sm leading-relaxed font-medium">
            {t("onboarding_welcome", { name: activeLearnerName || "" })}
          </p>

          {/* Action Row / Grid */}
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => onOpenIngest?.("camera")}
              className={cn(
                "flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-xs font-semibold",
                "border border-indigo-500/20 bg-gradient-to-r from-indigo-500/10 to-purple-500/10 text-indigo-600 hover:from-indigo-500/20 hover:to-purple-500/20 dark:text-indigo-400",
                "shadow-sm transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]",
              )}
            >
              <Camera className="h-4 w-4" />
              <span>{t("onboarding_ingest_btn")}</span>
            </button>
            <button
              type="button"
              onClick={onOpenScopeSwitcher}
              className={cn(
                "flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-xs font-semibold",
                "bg-muted hover:bg-muted/80 text-foreground border-border border",
                "shadow-sm transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]",
              )}
            >
              <BookOpen className="h-4 w-4" />
              <span>{t("onboarding_select_btn")}</span>
            </button>
          </div>

          {/* Small hint at the bottom */}
          <p className="text-muted-foreground text-center text-[10px] sm:text-xs">
            {t("onboarding_free_practice_hint")}
          </p>
        </div>
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
              ? "flex max-w-[75%] items-end gap-2 self-end"
              : "flex max-w-[75%] items-end gap-2 self-start"
          }
        >
          {m.role === "assistant" ? (
            <>
              <div className="bg-muted min-w-[2rem] rounded-2xl px-4 py-2">
                {m.streaming && !m.text ? (
                  <span className="flex items-center gap-1 py-0.5">
                    <span className="bg-muted-foreground h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:0ms]" />
                    <span className="bg-muted-foreground h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:150ms]" />
                    <span className="bg-muted-foreground h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:300ms]" />
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
              <div className="bg-primary text-primary-foreground rounded-2xl px-4 py-2">
                {m.pending ? (
                  <span className="flex items-center gap-1.5 opacity-70">
                    <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
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
