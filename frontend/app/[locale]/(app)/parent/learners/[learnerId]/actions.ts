"use server";

import { revalidatePath } from "next/cache";
import { createApi } from "@/lib/api";
import type { SyncPersonaBody, LearnerOut } from "@/lib/backend";

export async function syncPersona(learnerId: string, body: SyncPersonaBody): Promise<LearnerOut> {
  const api = await createApi();
  const updated = await api.learners.syncPersona(learnerId, body);
  revalidatePath(`/parent/learners/${learnerId}`);
  return updated;
}
