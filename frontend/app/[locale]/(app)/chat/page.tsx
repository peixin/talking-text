import { redirect } from "next/navigation";
import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { createApi } from "@/lib/api";

export default async function ChatPage() {
  const t = await getTranslations("Chat");
  const api = await createApi();

  const learners = await api.learners.list();

  if (learners.length === 0) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center justify-center py-20 text-center">
        <h2 className="mb-4 text-xl font-medium">{t("no_learners_title")}</h2>
        <p className="text-muted-foreground mb-8">{t("no_learners_desc")}</p>
        <Link
          href="/parent/learners"
          className="bg-primary text-primary-foreground rounded-md px-6 py-2 transition hover:opacity-90"
        >
          {t("go_add_child")}
        </Link>
      </div>
    );
  }

  const account = await api.auth.me();
  const activeLearnerId = account.last_active_learner_id;
  const activeLearner = learners.find((l) => l.id === activeLearnerId) ?? learners[0];

  let sessions = await api.sessions.list(activeLearner.id);
  if (sessions.length === 0) {
    const created = await api.sessions.create(activeLearner.id);
    sessions = [created];
  }

  const locale = await getLocale();
  redirect(`/${locale}/chat/${sessions[0].id}`);
}
