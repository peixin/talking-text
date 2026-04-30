"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Mic, Square, Loader2 } from "lucide-react";

import { LearnerOut } from "@/lib/backend";
import { Message, sendTurn, setActiveLearner } from "./actions";

type Mode = "idle" | "recording" | "uploading";

const HISTORY_TURNS = 6; // most recent N turns we send back as LLM context

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

function audioDataUrl(b64: string, fmt: string): string {
  const mime = fmt === "mp3" ? "audio/mpeg" : fmt === "ogg_opus" ? "audio/ogg" : "audio/wav";
  return `data:${mime};base64,${b64}`;
}

export function ChatClient({
  initialHistory,
  activeLearner,
  learners,
}: {
  initialHistory: Message[];
  activeLearner: LearnerOut;
  learners: LearnerOut[];
}) {
  const t = useTranslations("Chat");
  const tErr = useTranslations("Chat.errors");

  const [messages, setMessages] = useState<Message[]>(initialHistory);
  const [mode, setMode] = useState<Mode>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastAudioUrl, setLastAudioUrl] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const mimeRef = useRef<string>("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Sync active learner on mount.
  useEffect(() => {
    setActiveLearner(activeLearner.id);
  }, [activeLearner.id]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Autoplay newly-arrived AI audio.
  useEffect(() => {
    if (lastAudioUrl && audioRef.current) {
      audioRef.current.src = lastAudioUrl;
      audioRef.current.play().catch(() => {
        // Autoplay may be blocked until first user gesture; tap-to-record counts.
      });
    }
  }, [lastAudioUrl]);

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, sampleRate: 48000, echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      const mime = pickMimeType();
      mimeRef.current = mime;
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: mime || recorder.mimeType || "audio/webm",
        });
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        void uploadTurn(blob);
      };

      recorder.start();
      setMode("recording");
    } catch (e) {
      console.error(e);
      setError("CHAT_MIC_DENIED");
      setMode("idle");
    }
  }

  function stopRecording() {
    if (recorderRef.current && recorderRef.current.state === "recording") {
      recorderRef.current.stop();
      setMode("uploading");
    } else {
      setMode("idle");
    }
  }

  async function uploadTurn(blob: Blob) {
    if (blob.size === 0) {
      setError("CHAT_AUDIO_EMPTY");
      setMode("idle");
      return;
    }
    const recent = messages.slice(-HISTORY_TURNS);
    const fd = new FormData();
    const ext = (mimeRef.current || "audio/webm").includes("mp4") ? "mp4" : "webm";
    fd.append("audio", blob, `recording.${ext}`);
    fd.append("learner_id", activeLearner.id);
    fd.append("history", JSON.stringify(recent));

    const result = await sendTurn(fd);
    if (!result.ok) {
      setError(result.error);
      setMode("idle");
      return;
    }

    setMessages((prev) => [
      ...prev,
      { role: "user", text: result.text_user },
      { role: "assistant", text: result.text_ai },
    ]);
    setLastAudioUrl(audioDataUrl(result.audio_b64, result.audio_format));
    setMode("idle");
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col">
      <div className="mb-6 flex items-center justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-xl font-medium">{t("title")}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("welcome", { name: activeLearner.name })}
          </p>
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
              {learners.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="mb-6 flex min-h-[300px] flex-col gap-3">
        {messages.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center text-sm">{t("no_chat")}</p>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className={
                m.role === "user"
                  ? "self-end max-w-[80%] rounded-2xl bg-primary text-primary-foreground px-4 py-2"
                  : "self-start max-w-[80%] rounded-2xl bg-muted px-4 py-2"
              }
            >
              {m.text}
            </div>
          ))
        )}
      </div>

      <audio ref={audioRef} hidden />

      {error && (
        <p className="text-destructive mb-3 text-center text-sm">{tErr(error)}</p>
      )}

      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={mode === "recording" ? stopRecording : startRecording}
          disabled={mode === "uploading"}
          className={`flex h-20 w-20 items-center justify-center rounded-full transition ${
            mode === "recording"
              ? "bg-destructive text-destructive-foreground animate-pulse"
              : mode === "uploading"
                ? "bg-muted text-muted-foreground cursor-not-allowed"
                : "bg-primary text-primary-foreground hover:opacity-90"
          }`}
          aria-label={mode === "recording" ? t("stop") : t("press_to_talk")}
        >
          {mode === "recording" ? (
            <Square className="h-8 w-8" />
          ) : mode === "uploading" ? (
            <Loader2 className="h-8 w-8 animate-spin" />
          ) : (
            <Mic className="h-8 w-8" />
          )}
        </button>
        <span className="text-muted-foreground text-xs">
          {mode === "recording"
            ? t("recording_hint")
            : mode === "uploading"
              ? t("uploading_hint")
              : t("press_to_talk")}
        </span>
      </div>
    </div>
  );
}
