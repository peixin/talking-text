"use server";

import { revalidatePath } from "next/cache";

import {
  BackendError,
  type FileItemBody,
  type GroupOut,
  type InboxOut,
  type LanguageItemOut,
} from "@/lib/backend";
import { createApi } from "@/lib/api";

export async function reloadWorkbench(): Promise<
  { ok: true; inbox: InboxOut; groups: GroupOut[] } | { ok: false; error: string }
> {
  const api = await createApi();
  try {
    const [inbox, groups] = await Promise.all([api.organize.inbox(), api.groups.list(false)]);
    return { ok: true, inbox, groups };
  } catch (e) {
    return { ok: false, error: e instanceof BackendError ? e.detail : "INBOX_FAILED" };
  }
}

export async function fileItem(
  body: FileItemBody,
): Promise<{ ok: true; item: LanguageItemOut } | { ok: false; error: string }> {
  const api = await createApi();
  try {
    const item = await api.organize.file(body);
    revalidatePath("/parent/organize");
    revalidatePath("/parent/materials");
    revalidatePath("/chat");
    return { ok: true, item };
  } catch (e) {
    return { ok: false, error: e instanceof BackendError ? e.detail : "FILE_FAILED" };
  }
}

export async function dismissItem(
  groupId: string,
  itemId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const api = await createApi();
  try {
    await api.organize.dismiss(groupId, itemId);
    revalidatePath("/parent/organize");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof BackendError ? e.detail : "DISMISS_FAILED" };
  }
}
