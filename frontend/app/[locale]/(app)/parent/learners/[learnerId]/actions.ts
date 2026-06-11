"use server";

import { revalidatePath } from "next/cache";
import { createApi } from "@/lib/api";
import type { CorrectionLevel, SyncPersonaBody, LearnerOut } from "@/lib/backend";

export async function syncPersona(learnerId: string, body: SyncPersonaBody): Promise<LearnerOut> {
  const api = await createApi();
  const updated = await api.learners.syncPersona(learnerId, body);
  revalidatePath(`/parent/learners/${learnerId}`);
  return updated;
}

export async function setCorrectionLevel(
  learnerId: string,
  level: CorrectionLevel,
): Promise<LearnerOut> {
  const api = await createApi();
  const updated = await api.learners.updatePersona(learnerId, { correction_level: level });
  revalidatePath(`/parent/learners/${learnerId}`);
  return updated;
}
