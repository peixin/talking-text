"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Keyboard, Menu, Mic, Pencil, Send, X } from "lucide-react";
import { useLocale } from "next-intl";

import { LearnerOut, SessionOut, TurnOut } from "@/lib/backend";
import { useRouter } from "@/i18n/routing";
import { Message, createSession, deleteSession, getAudio, renameSession, setActiveLearner } from "./actions";
import { SessionSidebarClient } from "./SessionSidebarClient";
import { MessageListClient, AudioState } from "./MessageListClient";
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
  const locale = useLocale();

  const [sessions, setSessions] = useState<SessionOut[]>(initialSessions);
  const [activeSession, setActiveSession] = useState<SessionOut>(initialActiveSession);
  const [messages, setMessages] = useState<Message[]>(turnsToMessages(initialTurns));
  const [recordMode, setRecordMode] = useState<Mode>("idle");
  const [inputMode, setInputMode] = useState<"voice" | "text">("voice");
  const [textDraft, setTextDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<"active" | "soft_limit" | "hard_limit">("active");
  const [softLimitDismissed, setSoftLimitDismissed] = useState(false);

  // Title editing
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  // Recording
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const mimeRef = useRef<string>("");
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  // ── Unified audio (singleton <audio> owned by ChatClient) ─────────────────
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCacheRef = useRef<Map<string, string>>(new Map());
  const [audioState, setAudioState] = useState<AudioState>({
    playingTurnId: null,
    playingDir: null,
    loadingKey: null,
  });

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

  useEffect(() => {
    setSessionStatus("active");
    setSoftLimitDismissed(false);
  }, [activeSession.id]);

  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitle]);

  // ── Audio management ──────────────────────────────────────────────────────

  function playAudioUrl(url: string, turnId: string, dir: "in" | "out") {
    if (!audioRef.current) return;
    audioRef.current.src = url;
    audioRef.current.play().catch(() => {});
    setAudioState({ playingTurnId: turnId, playingDir: dir, loadingKey: null });
  }

  async function handlePlay(turnId: string, dir: "in" | "out") {
    if (audioState.loadingKey) return;

    const key = `${turnId}:${dir}`;

    // Toggle stop if this clip is currently playing.
    if (audioState.playingTurnId === turnId && audioState.playingDir === dir && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setAudioState({ playingTurnId: null, playingDir: null, loadingKey: null });
      return;
    }

    const cached = audioCacheRef.current.get(key);
    if (cached) {
      playAudioUrl(cached, turnId, dir);
      return;
    }

    setAudioState((s) => ({ ...s, loadingKey: key }));
    const result = await getAudio(activeSession.id, turnId, dir);
    if (result.ok) {
      const url = audioDataUrl(result.audio_b64, result.audio_format);
      audioCacheRef.current.set(key, url);
      playAudioUrl(url, turnId, dir);
    } else {
      setAudioState((s) => ({ ...s, loadingKey: null }));
    }
  }

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

  // ── Unified streaming turn submission ─────────────────────────────────────

  async function submitTurn(formData: FormData, isVoice: boolean) {
    setError(null);
    setRecordMode("uploading");

    const tempId = `tmp-${Date.now()}`;
    const inputText = !isVoice ? ((formData.get("text") as string) ?? "") : "";

    // Optimistic: add user message (pending for voice) + streaming AI placeholder.
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        text: inputText,
        turnId: tempId,
        pending: isVoice,
        inputMode: isVoice ? "voice" : "text",
      },
      { role: "assistant", text: "", turnId: tempId, streaming: true },
    ]);

    const t0 = performance.now();
    let response: Response;
    try {
      response = await fetch(`/nex-api/chat/${activeSession.id}/stream`, {
        method: "POST",
        body: formData,
      });
    } catch {
      setMessages((prev) => prev.filter((m) => m.turnId !== tempId));
      setError("CHAT_TURN_FAILED");
      setRecordMode("idle");
      return;
    }

    if (!response.ok) {
      setMessages((prev) => prev.filter((m) => m.turnId !== tempId));
      if (response.status === 401) {
        router.push(`/${locale}/login?expired=1`);
        return;
      }
      if (response.status === 422) {
        const body = await response.json().catch(() => ({}) as Record<string, unknown>);
        if ((body as Record<string, unknown>)?.detail === "SESSION_HARD_LIMIT") {
          setSessionStatus("hard_limit");
          setRecordMode("idle");
          return;
        }
      }
      setError("CHAT_TURN_FAILED");
      setRecordMode("idle");
      return;
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let realTurnId = tempId;
    let aiText = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let event: Record<string, string>;
          try {
            event = JSON.parse(line.slice(6)) as Record<string, string>;
          } catch {
            continue;
          }

          switch (event.event) {
            case "text_user":
              setMessages((prev) =>
                prev.map((m) =>
                  m.turnId === tempId && m.role === "user"
                    ? { ...m, text: event.text, pending: false }
                    : m,
                ),
              );
              break;

            case "text_ai_delta":
              aiText += event.delta;
              setMessages((prev) =>
                prev.map((m) =>
                  m.turnId === tempId && m.role === "assistant" ? { ...m, text: aiText } : m,
                ),
              );
              break;

            case "text_ai_done":
              realTurnId = event.turn_id;
              setMessages((prev) =>
                prev.map((m) =>
                  m.turnId === tempId ? { ...m, turnId: realTurnId, streaming: false } : m,
                ),
              );
              break;

            case "audio_ready":
              if (isVoice) {
                const url = audioDataUrl(event.audio_b64, event.audio_format);
                audioCacheRef.current.set(`${realTurnId}:out`, url);
                playAudioUrl(url, realTurnId, "out");
              }
              console.log(`[perf] audio_ready: ${(performance.now() - t0).toFixed(0)}ms`);
              break;

            case "done":
              if (event.session_title) {
                const title = event.session_title;
                setSessions((prev) =>
                  prev.map((s) => (s.id === activeSession.id ? { ...s, title } : s)),
                );
                setActiveSession((s) => ({ ...s, title }));
              }
              if (event.session_status === "soft_limit") {
                setSessionStatus("soft_limit");
                setSoftLimitDismissed(false);
              }
              console.log(`[perf] stream done: ${(performance.now() - t0).toFixed(0)}ms`);
              break;

            case "error":
              setMessages((prev) => prev.filter((m) => m.turnId !== tempId));
              setError(
                event.code === "EMPTY_TRANSCRIPTION"
                  ? "CHAT_EMPTY_TRANSCRIPTION"
                  : "CHAT_TURN_FAILED",
              );
              break;
          }
        }
      }
    } finally {
      setMessages((prev) =>
        prev.map((m) =>
          m.turnId === tempId ? { ...m, streaming: false, pending: false } : m,
        ),
      );
      setRecordMode("idle");
    }
  }

  // ── Voice input ───────────────────────────────────────────────────────────

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
        if (blob.size === 0) {
          setError("CHAT_AUDIO_EMPTY");
          setRecordMode("idle");
          return;
        }
        const fd = new FormData();
        const ext = (mimeRef.current || "audio/webm").includes("mp4") ? "mp4" : "webm";
        fd.append("audio", blob, `recording.${ext}`);
        void submitTurn(fd, true);
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

  // ── Text input ────────────────────────────────────────────────────────────

  async function submitTextTurn() {
    const text = textDraft.trim();
    if (!text || recordMode === "uploading") return;
    setTextDraft("");
    const fd = new FormData();
    fd.append("text", text);
    await submitTurn(fd, false);
  }

  // ── Render ────────────────────────────────────────────────────────────────

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

        {/* Singleton audio element — owned here, shared via handlePlay */}
        <audio
          ref={audioRef}
          hidden
          onEnded={() => setAudioState({ playingTurnId: null, playingDir: null, loadingKey: null })}
        />

        <MessageListClient
          messages={messages}
          sessionId={activeSession.id}
          audioState={audioState}
          onPlay={handlePlay}
        />

        {/* Soft-limit banner */}
        {sessionStatus === "soft_limit" && !softLimitDismissed && (
          <div className="flex shrink-0 items-center gap-3 border-t border-amber-200 bg-amber-50 px-4 py-2.5 dark:border-amber-900 dark:bg-amber-950">
            <span className="flex-1 text-sm text-amber-800 dark:text-amber-200">
              {t("session_soft_limit_text")}
            </span>
            <button
              type="button"
              onClick={() => void handleNewSession()}
              className="shrink-0 rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-amber-700"
            >
              {t("new_session")}
            </button>
            <button
              type="button"
              onClick={() => setSoftLimitDismissed(true)}
              className="shrink-0 text-amber-600 transition hover:text-amber-800 dark:text-amber-400"
              aria-label={t("session_soft_limit_dismiss")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="shrink-0 border-t border-border bg-background">
          {sessionStatus === "hard_limit" ? (
            <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
              <p className="text-sm text-muted-foreground">{t("session_hard_limit_text")}</p>
              <button
                type="button"
                onClick={() => void handleNewSession()}
                className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
              >
                {t("new_session")}
              </button>
            </div>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
