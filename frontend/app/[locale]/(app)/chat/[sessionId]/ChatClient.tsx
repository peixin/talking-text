"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Keyboard, Menu, Mic, Pencil, Send, X } from "lucide-react";

import { LearnerOut, SessionOut, TurnOut } from "@/lib/backend";
import { useRouter } from "@/i18n/routing";
import { Message, createSession, deleteSession, renameSession, sendTurn } from "./actions";
import { SessionSidebarClient } from "./SessionSidebarClient";
import { MessageListClient } from "./MessageListClient";
import { RecordButtonClient, Mode } from "./RecordButtonClient";

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
    { role: "user" as const, text: t.text_user, turnId: t.id },
    { role: "assistant" as const, text: t.text_ai, turnId: t.id },
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
  const tErr = useTranslations("Chat.errors");
  const router = useRouter();

  const [sessions, setSessions] = useState<SessionOut[]>(initialSessions);
  const [activeSession, setActiveSession] = useState<SessionOut>(initialActiveSession);
  const [messages, setMessages] = useState<Message[]>(turnsToMessages(initialTurns));
  const [recordMode, setRecordMode] = useState<Mode>("idle");
  const [inputMode, setInputMode] = useState<"voice" | "text">("voice");
  const [textDraft, setTextDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitle]);

  // ── Session management ─────────────────────────────────────────────────────

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

  // ── Title editing ──────────────────────────────────────────────────────────

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

  // ── Shared post-turn update ────────────────────────────────────────────────

  function applyTurnResult(
    text_user: string,
    text_ai: string,
    turn_id: string,
    session_title: string | null,
  ) {
    setMessages((prev) => [
      ...prev,
      { role: "user", text: text_user, turnId: turn_id },
      { role: "assistant", text: text_ai, turnId: turn_id },
    ]);
    setSessions((prev) => [
      { ...activeSession, title: session_title ?? activeSession.title },
      ...prev.filter((s) => s.id !== activeSession.id),
    ]);
    if (session_title && !activeSession.title) {
      setActiveSession((s) => ({ ...s, title: session_title }));
    }
  }

  // ── Voice input ────────────────────────────────────────────────────────────

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
        streamRef.current?.getTracks().forEach((tr) => tr.stop());
        streamRef.current = null;
        void submitVoiceTurn(blob);
      };

      recorder.start();
      setRecordMode("recording");
    } catch {
      setError("CHAT_MIC_DENIED");
      setRecordMode("idle");
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
      setRecordMode("uploading");
    } else {
      setRecordMode("idle");
    }
  }

  function handleRecordToggle() {
    if (recordMode === "recording") stopRecording();
    else if (recordMode === "idle") startRecording();
  }

  async function submitVoiceTurn(blob: Blob) {
    if (blob.size === 0) {
      setError("CHAT_AUDIO_EMPTY");
      setRecordMode("idle");
      return;
    }

    const fd = new FormData();
    const ext = (mimeRef.current || "audio/webm").includes("mp4") ? "mp4" : "webm";
    fd.append("audio", blob, `recording.${ext}`);

    const result = await sendTurn(activeSession.id, fd);
    if (!result.ok) {
      setError(result.error);
      setRecordMode("idle");
      return;
    }

    applyTurnResult(result.text_user, result.text_ai, result.turn_id, result.session_title);

    // Auto-play AI response (voice mode always returns audio).
    if (result.audio_b64 && result.audio_format && audioRef.current) {
      audioRef.current.src = audioDataUrl(result.audio_b64, result.audio_format);
      audioRef.current.play().catch(() => {});
    }

    setRecordMode("idle");
  }

  // ── Text input ─────────────────────────────────────────────────────────────

  async function submitTextTurn() {
    const text = textDraft.trim();
    if (!text || recordMode === "uploading") return;
    setError(null);
    setTextDraft("");
    setRecordMode("uploading");

    const fd = new FormData();
    fd.append("text", text);

    const result = await sendTurn(activeSession.id, fd);
    if (!result.ok) {
      setError(result.error);
      setRecordMode("idle");
      return;
    }

    applyTurnResult(result.text_user, result.text_ai, result.turn_id, result.session_title);
    // Text mode: no auto-play. User clicks the play button to generate audio on demand.

    setRecordMode("idle");
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-0 flex-1">
      <SessionSidebarClient
        sessions={sessions}
        activeSessionId={activeSession.id}
        activeLearner={activeLearner}
        learners={learners}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onNewSession={handleNewSession}
        onDeleteSession={handleDeleteSession}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        {/* Title bar */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
          <button
            className="shrink-0 text-muted-foreground hover:text-foreground md:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open sidebar"
          >
            <Menu className="h-5 w-5" />
          </button>
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

        <MessageListClient messages={messages} sessionId={activeSession.id} />

        {/* Singleton audio element for auto-play in voice mode */}
        <audio ref={audioRef} hidden />

        <div className="shrink-0 border-t border-border bg-background">
          {/* Mode toggle */}
          <div className="flex justify-end px-4 pt-2">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setInputMode((m) => (m === "voice" ? "text" : "voice"));
              }}
              className="flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground"
            >
              {inputMode === "voice" ? (
                <><Keyboard className="h-3.5 w-3.5" />{t("switch_to_text")}</>
              ) : (
                <><Mic className="h-3.5 w-3.5" />{t("switch_to_voice")}</>
              )}
            </button>
          </div>

          {inputMode === "voice" ? (
            <RecordButtonClient
              mode={recordMode}
              error={error}
              onRecordToggle={handleRecordToggle}
            />
          ) : (
            <div className="flex flex-col gap-2 px-4 pb-4 pt-2">
              {error && (
                <p className="text-destructive text-center text-sm">
                  {tErr(error as Parameters<typeof tErr>[0])}
                </p>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  value={textDraft}
                  onChange={(e) => setTextDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void submitTextTurn();
                    }
                  }}
                  disabled={recordMode === "uploading"}
                  placeholder={t("text_placeholder")}
                  rows={2}
                  className="flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => void submitTextTurn()}
                  disabled={!textDraft.trim() || recordMode === "uploading"}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label={t("send")}
                >
                  {recordMode === "uploading" ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
