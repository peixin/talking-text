import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { createApi } from "@/lib/api";
import { ChatClient } from "./ChatClient";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ locale: string; sessionId: string }>;
}) {
  const { sessionId } = await params;
  const locale = await getLocale();
  const api = await createApi();

  const [learners, account] = await Promise.all([
    api.learners.list(),
    api.auth.me(),
  ]);

  if (learners.length === 0) {
    redirect(`/${locale}/chat`);
  }

  const activeLearnerId = account.last_active_learner_id;
  const activeLearner = learners.find((l) => l.id === activeLearnerId) ?? learners[0];

  const sessions = await api.sessions.list(activeLearner.id);
  const activeSession = sessions.find((s) => s.id === sessionId);

  if (!activeSession) {
    redirect(`/${locale}/chat`);
  }

  const initialTurns = await api.sessions.turns(sessionId);

  return (
    <ChatClient
      sessions={sessions}
      activeSession={activeSession}
      initialTurns={initialTurns}
      activeLearner={activeLearner}
      learners={learners}
    />
  );
}
