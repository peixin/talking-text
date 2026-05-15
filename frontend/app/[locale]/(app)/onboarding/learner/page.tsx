import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";

import { createApi } from "@/lib/api";
import { OnboardingLearnerClient } from "./OnboardingLearnerClient";

export default async function OnboardingLearnerPage() {
  const api = await createApi();
  const learners = await api.learners.list();

  // Already onboarded — skip straight to chat.
  if (learners.length > 0) {
    const locale = await getLocale();
    redirect(`/${locale}/chat`);
  }

  return <OnboardingLearnerClient />;
}
