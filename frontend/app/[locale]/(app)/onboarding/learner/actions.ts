"use server";

import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";

import { BackendError } from "@/lib/backend";
import { createApi } from "@/lib/api";

export type CreateLearnerResult = { error: string } | null;

export async function createFirstLearner(
  _prev: CreateLearnerResult,
  formData: FormData,
): Promise<CreateLearnerResult> {
  const name = String(formData.get("name") ?? "").trim();
  const cefrRaw = String(formData.get("cefr_level") ?? "").trim();
  const cefr = cefrRaw && cefrRaw !== "unknown" ? cefrRaw : null;

  if (!name) return { error: "ONBOARDING_NAME_REQUIRED" };

  const api = await createApi();
  try {
    await api.learners.create(name, cefr);
  } catch (e) {
    if (e instanceof BackendError) {
      return { error: e.detail || "ONBOARDING_CREATE_FAILED" };
    }
    return { error: "ONBOARDING_CREATE_FAILED" };
  }

  const locale = await getLocale();
  redirect(`/${locale}/chat`);
}
