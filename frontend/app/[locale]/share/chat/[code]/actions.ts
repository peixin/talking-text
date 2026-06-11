"use server";

import { BackendError, backend } from "@/lib/backend";

export type SharedAudioResult =
  | { ok: true; audio_b64: string; audio_format: string }
  | { ok: false; error: string };

export async function getSharedAudio(
  code: string,
  turnId: string,
  dir: "in" | "out",
): Promise<SharedAudioResult> {
  try {
    const { data, contentType } = await backend.chatShare.getSharedAudio(code, turnId, dir);
    const audio_b64 = Buffer.from(data).toString("base64");
    const audio_format = contentType.includes("mpeg") ? "mp3" : "ogg_opus";
    return { ok: true, audio_b64, audio_format };
  } catch (e) {
    if (e instanceof BackendError) {
      return { ok: false, error: e.detail || "SHARE_AUDIO_FAILED" };
    }
    return { ok: false, error: "SHARE_AUDIO_FAILED" };
  }
}
