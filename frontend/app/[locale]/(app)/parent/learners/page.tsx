import { getTranslations } from "next-intl/server";
import { createApi } from "@/lib/api";
import { Link } from "@/i18n/routing";
import { LearnerClient } from "./LearnerClient";

export default async function LearnersPage() {
  const t = await getTranslations("Learners");

  const api = await createApi();
  const [learners, account] = await Promise.all([
    api.learners.list(),
    api.auth.me(),
  ]);
  const activeLearner = account.last_active_learner_id ?? null;

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/parent" className="text-muted-foreground hover:text-primary transition">
          &larr; {t("back")}
        </Link>
        <h1 className="text-xl font-medium">{t("page_title")}</h1>
      </div>

      <LearnerClient learners={learners} activeLearnerId={activeLearner} />
    </div>
  );
}
