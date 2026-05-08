"use server";

import { revalidatePath } from "next/cache";
import { createApi } from "@/lib/api";
import type { CurriculumLessonsOut, SyncPersonaBody, LearnerOut } from "@/lib/backend";

export async function addLesson(learnerId: string, lessonId: string): Promise<void> {
  const api = await createApi();
  await api.learnerLessons.add(learnerId, lessonId);
  revalidatePath(`/learner/${learnerId}`);
}

export async function removeLesson(learnerId: string, lessonId: string): Promise<void> {
  const api = await createApi();
  await api.learnerLessons.remove(learnerId, lessonId);
  revalidatePath(`/learner/${learnerId}`);
}

export async function fetchCurriculumLessons(
  curriculumId: string
): Promise<CurriculumLessonsOut> {
  const api = await createApi();
  return api.curricula.getLessons(curriculumId);
}

export async function syncPersona(
  learnerId: string,
  body: SyncPersonaBody
): Promise<LearnerOut> {
  const api = await createApi();
  const updated = await api.learners.syncPersona(learnerId, body);
  revalidatePath(`/learner/${learnerId}`);
  return updated;
}
