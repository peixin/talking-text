"use server";

import { revalidatePath } from "next/cache";
import { BackendError } from "@/lib/backend";
import { createApi } from "@/lib/api";

export type AssignActionResult = { ok: true } | { ok: false; error: string };

export async function assignLearnerAction(
  groupId: string,
  learnerId: string,
): Promise<AssignActionResult> {
  const api = await createApi();
  try {
    await api.groups.assignLearner(groupId, learnerId);
    revalidatePath(`/parent/materials/${groupId}/learners`);
    revalidatePath(`/parent/materials/${groupId}`);
    return { ok: true };
  } catch (e) {
    const detail = e instanceof BackendError ? e.detail : "ASSIGN_FAILED";
    return { ok: false, error: detail };
  }
}

export async function unassignLearnerAction(
  groupId: string,
  learnerId: string,
): Promise<AssignActionResult> {
  const api = await createApi();
  try {
    await api.groups.unassignLearner(groupId, learnerId);
    revalidatePath(`/parent/materials/${groupId}/learners`);
    revalidatePath(`/parent/materials/${groupId}`);
    return { ok: true };
  } catch (e) {
    const detail = e instanceof BackendError ? e.detail : "UNASSIGN_FAILED";
    return { ok: false, error: detail };
  }
}
