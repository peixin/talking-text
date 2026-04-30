"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";

import { BackendError, SessionOut, TurnResponse, backend } from "@/lib/backend";
import { createApi } from "@/lib/api";

// ── Auth helper (no redirect — lets callers decide) ───────────────────────────

async function authHeaders(): Promise<HeadersInit> {
  const jar = await cookies();
  const token = jar.get("session")?.value;
  return token ? { Cookie: `session=${token}` } : {};
}

// ── Session actions ──────────────────────────────────────────────────────────

export async function createSession(learnerId: string): Promise<SessionOut> {
  const api = await createApi();
  return api.sessions.create(learnerId);
}

export async function renameSession(sessionId: string, title: string): Promise<SessionOut> {
  const api = await createApi();
  return api.sessions.rename(sessionId, title);
}

export async function deleteSession(sessionId: string): Promise<void> {
  const api = await createApi();
  await api.sessions.delete(sessionId);
}

export async function setActiveLearner(learnerId: string): Promise<void> {
  const api = await createApi();
  await api.learners.setActive(learnerId);
}

// ── Turn action ───────────────────────────────────────────────────────────────

export type Message = {
  role: "user" | "assistant";
  text: string;
  turnId?: string;
  hasAudio?: boolean;
};

export type SendTurnResult =
  | {
      ok: true;
      turn_id: string;
      text_user: string;
      text_ai: string;
      audio_b64: string;
      audio_format: string;
      session_title: string | null;
    }
  | { ok: false; error: string };

export async function sendTurn(
  sessionId: string,
  formData: FormData,
): Promise<SendTurnResult> {
  const audio = formData.get("audio");

  if (!(audio instanceof File) || audio.size === 0) {
    return { ok: false, error: "CHAT_AUDIO_EMPTY" };
  }

  const upstream = new FormData();
  upstream.append("audio", audio, audio.name || "recording.webm");

  const h = await authHeaders();
  try {
    const result = await backend.sessions.sendTurn(sessionId, upstream, h);
    return {
      ok: true,
      turn_id: result.turn_id,
      text_user: result.text_user,
      text_ai: result.text_ai,
      audio_b64: result.audio_b64,
      audio_format: result.audio_format,
      session_title: result.session_title,
    };
  } catch (e) {
    if (e instanceof BackendError) {
      if (e.status === 401) {
        const locale = await getLocale();
        redirect(`/${locale}/login?expired=1`);
      }
      if (e.status === 422 && e.detail === "EMPTY_TRANSCRIPTION") {
        return { ok: false, error: "CHAT_EMPTY_TRANSCRIPTION" };
      }
      if (e.status === 404) {
        return { ok: false, error: "CHAT_SESSION_REQUIRED" };
      }
    }
    return { ok: false, error: "CHAT_TURN_FAILED" };
  }
}

export type GetAudioResult =
  | { ok: true; audio_b64: string; audio_format: string }
  | { ok: false; error: string };

export async function getAudio(
  sessionId: string,
  turnId: string,
  dir: "in" | "out",
): Promise<GetAudioResult> {
  const api = await createApi();
  try {
    const { data, contentType } = await api.sessions.getTurnAudio(sessionId, turnId, dir);
    const audio_b64 = Buffer.from(data).toString("base64");
    const audio_format = contentType.includes("mpeg") ? "mp3" : "ogg_opus";
    return { ok: true, audio_b64, audio_format };
  } catch (e) {
    if (e instanceof BackendError && e.status === 401) {
      const locale = await getLocale();
      redirect(`/${locale}/login?expired=1`);
    }
    return { ok: false, error: "CHAT_TURN_FAILED" };
  }
}
