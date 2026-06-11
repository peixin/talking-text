"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Play, Square } from "lucide-react";

import { SharedChatOut } from "@/lib/backend";
import { getSharedAudio } from "./actions";

type AudioState = {
  playingKey: string | null; // "<turnId>:<dir>"
  loadingKey: string | null;
};

function audioDataUrl(b64: string, fmt: string): string {
  const mime = fmt === "mp3" ? "audio/mpeg" : fmt === "ogg_opus" ? "audio/ogg" : "audio/wav";
  return `data:${mime};base64,${b64}`;
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
  const isPlaying = audioState.playingKey === key;

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

export function SharedChatClient({ code, chat }: { code: string; chat: SharedChatOut }) {
  const t = useTranslations("SharedChat");

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCacheRef = useRef<Map<string, string>>(new Map());
  const [audioState, setAudioState] = useState<AudioState>({
    playingKey: null,
    loadingKey: null,
  });

  function playAudioUrl(url: string, key: string) {
    if (!audioRef.current) return;
    audioRef.current.src = url;
    audioRef.current.play().catch(() => {});
    setAudioState({ playingKey: key, loadingKey: null });
  }

  async function handlePlay(turnId: string, dir: "in" | "out") {
    if (audioState.loadingKey) return;
    const key = `${turnId}:${dir}`;

    // Toggle stop if this clip is currently playing.
    if (audioState.playingKey === key && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setAudioState({ playingKey: null, loadingKey: null });
      return;
    }

    const cached = audioCacheRef.current.get(key);
    if (cached) {
      playAudioUrl(cached, key);
      return;
    }

    setAudioState((s) => ({ ...s, loadingKey: key }));
    const result = await getSharedAudio(code, turnId, dir);
    if (result.ok) {
      const url = audioDataUrl(result.audio_b64, result.audio_format);
      audioCacheRef.current.set(key, url);
      playAudioUrl(url, key);
    } else {
      setAudioState((s) => ({ ...s, loadingKey: null }));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <audio
        ref={audioRef}
        hidden
        onEnded={() => setAudioState({ playingKey: null, loadingKey: null })}
      />

      {chat.turns.map((turn) => (
        <div key={turn.id} className="contents">
          {/* Child side — anonymized label lives in the page header, bubbles are bare */}
          {turn.text_user && (
            <div className="flex max-w-[75%] items-end gap-2 self-end">
              {turn.has_audio_in && (
                <PlayButton
                  turnId={turn.id}
                  dir="in"
                  audioState={audioState}
                  onPlay={handlePlay}
                  title={t("play_audio")}
                />
              )}
              <div className="bg-primary text-primary-foreground rounded-2xl px-4 py-2">
                {turn.text_user}
              </div>
            </div>
          )}

          {/* AI side */}
          <div className="flex max-w-[75%] items-end gap-2 self-start">
            <div className="bg-muted min-w-[2rem] rounded-2xl px-4 py-2">{turn.text_ai}</div>
            {turn.has_audio_out && (
              <PlayButton
                turnId={turn.id}
                dir="out"
                audioState={audioState}
                onPlay={handlePlay}
                title={t("play_audio")}
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
