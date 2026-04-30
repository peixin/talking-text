"use server";

import { cookies } from "next/headers";

import { BackendError, backend } from "@/lib/backend";

async function authHeaders(): Promise<HeadersInit | undefined> {
  const jar = await cookies();
  const session = jar.get("session")?.value;
  return session ? { Cookie: `session=${session}` } : undefined;
}

export async function setActiveLearner(learnerId: string) {
  await backend.learners.setActive(learnerId, await authHeaders());
}

export type Message = { role: "user" | "assistant"; text: string };

export type SendTurnResult =
  | {
      ok: true;
      turn_id: string;
      text_user: string;
      text_ai: string;
      audio_b64: string;
      audio_format: string;
    }
  | {
      ok: false;
      error: string;
    };

export async function sendTurn(formData: FormData): Promise<SendTurnResult> {
  const audio = formData.get("audio");
  const learnerId = String(formData.get("learner_id") ?? "");
  const history = String(formData.get("history") ?? "[]");

  if (!(audio instanceof File) || audio.size === 0) {
    return { ok: false, error: "CHAT_AUDIO_EMPTY" };
  }
  if (!learnerId) {
    return { ok: false, error: "CHAT_LEARNER_REQUIRED" };
  }

  const upstream = new FormData();
  upstream.append("audio", audio, audio.name || "recording.webm");
  upstream.append("learner_id", learnerId);
  upstream.append("history", history);

  try {
    const result = await backend.conversation.turn(upstream, await authHeaders());
    return {
      ok: true,
      turn_id: result.turn_id,
      text_user: result.text_user,
      text_ai: result.text_ai,
      audio_b64: result.audio_b64,
      audio_format: result.audio_format,
    };
  } catch (e) {
    if (e instanceof BackendError) {
      if (e.status === 422 && e.detail === "EMPTY_TRANSCRIPTION") {
        return { ok: false, error: "CHAT_EMPTY_TRANSCRIPTION" };
      }
      if (e.status === 404) {
        return { ok: false, error: "CHAT_LEARNER_NOT_FOUND" };
      }
    }
    return { ok: false, error: "CHAT_TURN_FAILED" };
  }
}
