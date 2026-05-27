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

export async function createGroup(
  body: import("@/lib/backend").GroupCreateBody,
): Promise<{ ok: true; group: import("@/lib/backend").GroupOut } | { ok: false; error: string }> {
  const api = await createApi();
  try {
    const group = await api.groups.create(body);
    revalidatePath("/parent/materials");
    revalidatePath("/chat");
    return { ok: true, group };
  } catch (e) {
    return { ok: false, error: e instanceof BackendError ? e.detail : "GROUP_CREATE_FAILED" };
  }
}

export async function updateGroup(
  id: string,
  body: {
    name?: string;
    archived?: boolean;
    parent_id?: string | null;
    kind?: string;
    source_book_hint?: string | null;
    prompt_notes?: string | null;
    items?: Array<{
      text: string;
      type: import("@/lib/backend").ItemType;
      anchor?: string | null;
      cefr_level?: string | null;
      pos?: string | null;
    }> | null;
    levels?: string[] | null;
  },
): Promise<GroupActionResult> {
  const api = await createApi();
  try {
    await api.groups.update(id, body);
    revalidatePath("/parent/materials");
    revalidatePath(`/parent/materials/${id}`);
    revalidatePath("/chat");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof BackendError ? e.detail : "GROUP_UPDATE_FAILED" };
  }
}

export async function startSessionFromGroupAction(
  groupId: string,
): Promise<{ ok: true; sessionId: string } | { ok: false; error: string }> {
  const api = await createApi();
  try {
    const me = await api.auth.me();
    let activeLearnerId = me.last_active_learner_id;

    if (!activeLearnerId) {
      // 自动尝试寻找当前账号下的孩子档案
      const learners = await api.learners.list();
      if (learners.length === 0) {
        return { ok: false, error: "没有找到孩子档案。请先在首页或孩子管理中创建孩子档案。" };
      }
      const firstLearner = learners[0];
      await api.learners.setActive(firstLearner.id);
      activeLearnerId = firstLearner.id;
    }

    const session = await api.sessions.create(activeLearnerId, groupId);
    return { ok: true, sessionId: session.id };
  } catch (e) {
    return { ok: false, error: e instanceof BackendError ? e.detail : "SESSION_CREATE_FAILED" };
  }
}
