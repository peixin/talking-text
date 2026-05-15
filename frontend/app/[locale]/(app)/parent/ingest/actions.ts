"use server";

import { createApi } from "@/lib/api";
import { revalidatePath } from "next/cache";

export async function extractContent(formData: FormData) {
  const api = await createApi();
  return await api.ingestion.extract(formData);
}

export async function saveToLesson(body: any) {
  const api = await createApi();
  const res = await api.ingestion.saveToLesson(body);
  revalidatePath("/parent");
  return res;
}

export async function saveToCollection(body: any) {
  const api = await createApi();
  const res = await api.ingestion.saveToCollection(body);
  revalidatePath("/parent");
  return res;
}

export async function listCollections(learnerId: string) {
  const api = await createApi();
  return await api.collections.list(learnerId);
}

export async function listCurricula() {
  const api = await createApi();
  return await api.curriculum.list();
}

export async function getCurriculumLessons(curriculumId: string) {
  const api = await createApi();
  return await api.curriculum.getLessons(curriculumId);
}
