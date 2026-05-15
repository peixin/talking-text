"use server";

import { revalidatePath } from "next/cache";

import { BackendError } from "@/lib/backend";
import { createApi } from "@/lib/api";

export type GroupActionResult = { ok: true } | { ok: false; error: string };

export async function renameGroup(id: string, name: string): Promise<GroupActionResult> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "GROUP_NAME_REQUIRED" };
  const api = await createApi();
  try {
    await api.groups.update(id, { name: trimmed });
    revalidatePath("/parent/materials");
    revalidatePath("/chat");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof BackendError ? e.detail : "GROUP_UPDATE_FAILED" };
  }
}

export async function archiveGroup(id: string, archived: boolean): Promise<GroupActionResult> {
  const api = await createApi();
  try {
    await api.groups.update(id, { archived });
    revalidatePath("/parent/materials");
    revalidatePath("/chat");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof BackendError ? e.detail : "GROUP_UPDATE_FAILED" };
  }
}

export async function deleteGroup(id: string): Promise<GroupActionResult> {
  const api = await createApi();
  try {
    await api.groups.delete(id);
    revalidatePath("/parent/materials");
    revalidatePath("/chat");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof BackendError ? e.detail : "GROUP_DELETE_FAILED" };
  }
}
