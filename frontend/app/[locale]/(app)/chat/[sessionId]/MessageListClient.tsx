"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Play, Square } from "lucide-react";

import { getAudio, Message } from "./actions";

interface Props {
  messages: Message[];
  sessionId: string;
}

function audioDataUrl(b64: string, fmt: string): string {
  const mime = fmt === "mp3" ? "audio/mpeg" : "audio/ogg";
  return `data:${mime};base64,${b64}`;
}

function PlayButton({
  turnId,
  dir,
  loading,
  playing,
  onPlay,
  title,
}: {
  turnId: string;
  dir: "in" | "out";
  loading: { turnId: string; dir: "in" | "out" } | null;
  playing: { turnId: string; dir: "in" | "out" } | null;
  onPlay: (turnId: string, dir: "in" | "out") => void;
  title: string;
}) {
  const isLoading = loading?.turnId === turnId && loading?.dir === dir;
  const isPlaying = playing?.turnId === turnId && playing?.dir === dir;
  return (
    <button
      onClick={() => onPlay(turnId, dir)}
      disabled={isLoading}
      className="mb-1 shrink-0 text-muted-foreground transition hover:text-foreground disabled:opacity-40"
      title={title}
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : isPlaying ? (
        <Square className="h-4 w-4 fill-current" />
      ) : (
        <Play className="h-4 w-4" />
      )}
    </button>
  );
}

export function MessageListClient({ messages, sessionId }: Props) {
  const t = useTranslations("Chat");
  const endRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [loading, setLoading] = useState<{ turnId: string; dir: "in" | "out" } | null>(null);
  const [playing, setPlaying] = useState<{ turnId: string; dir: "in" | "out" } | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handlePlay(turnId: string, dir: "in" | "out") {
    if (loading) return;

    // Toggle stop if already playing this exact audio.
    if (playing?.turnId === turnId && playing?.dir === dir && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setPlaying(null);
      return;
    }

    setLoading({ turnId, dir });
    const result = await getAudio(sessionId, turnId, dir);
    setLoading(null);
    if (result.ok && audioRef.current) {
      audioRef.current.src = audioDataUrl(result.audio_b64, result.audio_format);
      audioRef.current.play().catch(() => {});
      setPlaying({ turnId, dir });
    }
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground text-center text-sm">{t("no_chat")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
      <audio ref={audioRef} hidden onEnded={() => setPlaying(null)} />
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
              <div className="rounded-2xl bg-muted px-4 py-2">{m.text}</div>
              {m.hasAudio && m.turnId && (
                <PlayButton
                  turnId={m.turnId}
                  dir="out"
                  loading={loading}
                  playing={playing}
                  onPlay={handlePlay}
                  title={t("play_audio")}
                />
              )}
            </>
          ) : (
            <>
              {m.hasAudio && m.turnId && (
                <PlayButton
                  turnId={m.turnId}
                  dir="in"
                  loading={loading}
                  playing={playing}
                  onPlay={handlePlay}
                  title={t("play_audio")}
                />
              )}
              <div className="rounded-2xl bg-primary px-4 py-2 text-primary-foreground">
                {m.text}
              </div>
            </>
          )}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
