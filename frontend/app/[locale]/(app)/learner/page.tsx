import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { createApi } from "@/lib/api";

export default async function LearnerIndexPage() {
  const api = await createApi();
  const learners = await api.learners.list();

  if (learners.length === 0) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center justify-center py-20 text-center">
        <h2 className="mb-4 text-xl font-medium">No learners yet</h2>
        <p className="text-muted-foreground mb-8">Add a child profile to get started.</p>
        <Link
          href="/parent/learners"
          className="bg-primary text-primary-foreground rounded-md px-6 py-2 transition hover:opacity-90"
        >
          Add a child
        </Link>
      </div>
    );
  }

  const account = await api.auth.me();
  const activeLearner =
    learners.find((l) => l.id === account.last_active_learner_id) ?? learners[0];

  const locale = await getLocale();
  redirect(`/${locale}/learner/${activeLearner.id}`);
}
