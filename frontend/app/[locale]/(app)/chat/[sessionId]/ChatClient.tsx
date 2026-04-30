"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Pencil, X } from "lucide-react";

import { LearnerOut, SessionOut, TurnOut } from "@/lib/backend";
import { useRouter } from "@/i18n/routing";
import { Message, createSession, deleteSession, renameSession, sendTurn } from "./actions";
import { SessionSidebarClient } from "./SessionSidebarClient";
import { MessageListClient } from "./MessageListClient";
import { RecordButtonClient, Mode } from "./RecordButtonClient";

const HISTORY_TURNS = 6;

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

function audioDataUrl(b64: string, fmt: string): string {
  const mime = fmt === "mp3" ? "audio/mpeg" : fmt === "ogg_opus" ? "audio/ogg" : "audio/wav";
  return `data:${mime};base64,${b64}`;
}

function turnsToMessages(turns: TurnOut[]): Message[] {
  return turns.flatMap((t) => [
    { role: "user" as const, text: t.text_user },
    { role: "assistant" as const, text: t.text_ai },
  ]);
}

export function ChatClient({
  sessions: initialSessions,
  activeSession: initialActiveSession,
  initialTurns,
  activeLearner,
  learners,
}: {
  sessions: SessionOut[];
  activeSession: SessionOut;
  initialTurns: TurnOut[];
  activeLearner: LearnerOut;
  learners: LearnerOut[];
}) {
  const t = useTranslations("Chat");
  const router = useRouter();

  const [sessions, setSessions] = useState<SessionOut[]>(initialSessions);
  const [activeSession, setActiveSession] = useState<SessionOut>(initialActiveSession);
  const [messages, setMessages] = useState<Message[]>(turnsToMessages(initialTurns));
  const [mode, setMode] = useState<Mode>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastAudioUrl, setLastAudioUrl] = useState<string | null>(null);

  // Title editing
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const mimeRef = useRef<string>("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    if (lastAudioUrl && audioRef.current) {
      audioRef.current.src = lastAudioUrl;
      audioRef.current.play().catch(() => {});
    }
  }, [lastAudioUrl]);

  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitle]);

  // ── Session management ────────────────────────────────────────────────────

  async function handleNewSession() {
    try {
      const session = await createSession(activeLearner.id);
      router.push(`/chat/${session.id}`);
    } catch {
      setError("CHAT_TURN_FAILED");
    }
  }

  async function handleDeleteSession(session: SessionOut) {
    if (!confirm(t("session_delete_confirm"))) return;
    try {
      await deleteSession(session.id);
      if (session.id === activeSession.id) {
        const remaining = sessions.filter((s) => s.id !== session.id);
        if (remaining.length > 0) {
          router.push(`/chat/${remaining[0].id}`);
        } else {
          const fresh = await createSession(activeLearner.id);
          router.push(`/chat/${fresh.id}`);
        }
      } else {
        setSessions((prev) => prev.filter((s) => s.id !== session.id));
      }
    } catch {
      setError("CHAT_TURN_FAILED");
    }
  }

  // ── Title editing ─────────────────────────────────────────────────────────

  function startEditTitle() {
    setTitleDraft(activeSession.title ?? "");
    setEditingTitle(true);
  }

  async function commitTitle() {
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (trimmed === (activeSession.title ?? "")) return;
    try {
      const updated = await renameSession(activeSession.id, trimmed);
      setActiveSession(updated);
      setSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    } catch {
      // non-critical
    }
  }

  function cancelEditTitle() {
    setEditingTitle(false);
  }

  // ── Recording ─────────────────────────────────────────────────────────────

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
    } catch {
      setError("CHAT_MIC_DENIED");
      setMode("idle");
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
      setMode("uploading");
    } else {
      setMode("idle");
    }
  }

  function handleRecordToggle() {
    if (mode === "recording") stopRecording();
    else if (mode === "idle") startRecording();
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
    fd.append("history", JSON.stringify(recent));

    const result = await sendTurn(activeSession.id, fd);
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

    // Update title if LLM just generated one on the first turn
    if (result.session_title && !activeSession.title) {
      const updated = { ...activeSession, title: result.session_title };
      setActiveSession(updated);
      setSessions((prev) => [
        updated,
        ...prev.filter((s) => s.id !== updated.id),
      ]);
    } else {
      // Move to top (updated_at was touched)
      setSessions((prev) => [
        { ...activeSession, title: result.session_title ?? activeSession.title },
        ...prev.filter((s) => s.id !== activeSession.id),
      ]);
    }

    setMode("idle");
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      <SessionSidebarClient
        sessions={sessions}
        activeSessionId={activeSession.id}
        activeLearner={activeLearner}
        learners={learners}
        onNewSession={handleNewSession}
        onDeleteSession={handleDeleteSession}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Title bar */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          {editingTitle ? (
            <>
              <input
                ref={titleInputRef}
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitTitle();
                  if (e.key === "Escape") cancelEditTitle();
                }}
                className="flex-1 rounded border border-border bg-background px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder={t("session_title_placeholder")}
                maxLength={200}
              />
              <button onClick={commitTitle} className="text-muted-foreground hover:text-foreground">
                <Check className="h-4 w-4" />
              </button>
              <button onClick={cancelEditTitle} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </>
          ) : (
            <>
              <span className="flex-1 truncate text-sm font-medium">
                {activeSession.title ? (
                  activeSession.title
                ) : (
                  <span className="inline-block h-4 w-32 animate-pulse rounded bg-muted" />
                )}
              </span>
              <button
                onClick={startEditTitle}
                className="text-muted-foreground/40 transition hover:text-muted-foreground"
                title={t("session_rename")}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>

        <MessageListClient messages={messages} />

        <audio ref={audioRef} hidden />

        <RecordButtonClient
          mode={mode}
          error={error}
          onRecordToggle={handleRecordToggle}
        />
      </div>
    </div>
  );
}
