import { notFound } from "next/navigation";
import { createApi } from "@/lib/api";
import { LearnerSettingsClient } from "./LearnerSettingsClient";

interface Props {
  params: Promise<{ learnerId: string; locale: string }>;
}

export default async function LearnerSettingsPage({ params }: Props) {
  const { learnerId } = await params;
  const api = await createApi();

  const learners = await api.learners.list();
  const learner = learners.find((l) => l.id === learnerId);
  if (!learner) notFound();

  return (
    <LearnerSettingsClient
      learnerId={learnerId}
      learnerName={learner.name}
      aiName={learner.ai_name}
      aiGender={learner.ai_gender}
      aiPersonaPrompt={learner.ai_persona_prompt}
    />
  );
}
