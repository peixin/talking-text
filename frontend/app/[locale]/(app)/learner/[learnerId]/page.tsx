import { createApi } from "@/lib/api";
import { LearnerHomeClient } from "./LearnerHomeClient";

interface Props {
  params: Promise<{ learnerId: string; locale: string }>;
}

export default async function LearnerHomePage({ params }: Props) {
  const { learnerId } = await params;
  const api = await createApi();

  const [learners, enrolledLessons, curricula] = await Promise.all([
    api.learners.list(),
    api.learnerLessons.list(learnerId),
    api.curricula.list(),
  ]);

  const learner = learners.find((l) => l.id === learnerId);
  if (!learner) return <div>Learner not found.</div>;

  return (
    <LearnerHomeClient
      learnerId={learnerId}
      learnerName={learner.name}
      aiName={learner.ai_name}
      aiGender={learner.ai_gender}
      aiPersonaPrompt={learner.ai_persona_prompt}
      enrolledLessons={enrolledLessons}
      curricula={curricula}
    />
  );
}
