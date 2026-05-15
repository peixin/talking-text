import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { Link } from "@/i18n/routing";
import { createApi } from "@/lib/api";
import type { GroupKind, GroupOut, SessionOut } from "@/lib/backend";

// `t` namespace below is "Chat"; the no-learners branch now redirects to
// /onboarding/learner so the surrounding "no_learners_*" strings stay in
// /onboarding instead.


const KIND_EMOJI: Record<GroupKind, string> = {
  textbook_book: "📕",
  textbook_unit: "📕",
  textbook_lesson: "📕",
  personal_collection: "🔖",
  quick_practice: "⚡",
  review_set: "🔁",
};

const FREE_EMOJI = "✨";

function fmtRelative(iso: string, locale: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  const tag = locale.toLowerCase().startsWith("zh") ? "zh" : "en";

  if (days <= 0) return tag === "zh" ? "今天" : "today";
  if (days === 1) return tag === "zh" ? "昨天" : "yesterday";
  if (days < 7) return tag === "zh" ? `${days} 天前` : `${days} days ago`;
  if (days < 30) {
    const w = Math.floor(days / 7);
    return tag === "zh" ? `${w} 周前` : `${w} ${w === 1 ? "week" : "weeks"} ago`;
  }
  const m = Math.floor(days / 30);
  return tag === "zh" ? `${m} 月前` : `${m} ${m === 1 ? "month" : "months"} ago`;
}

export default async function ChatHomePage() {
  const t = await getTranslations("Chat");
  const locale = await getLocale();
  const api = await createApi();

  const learners = await api.learners.list();

  if (learners.length === 0) {
    redirect(`/${locale}/onboarding/learner`);
  }

  const account = await api.auth.me();
  const activeLearnerId = account.last_active_learner_id;
  const activeLearner = learners.find((l) => l.id === activeLearnerId) ?? learners[0];

  const [sessions, groups] = await Promise.all([
    api.sessions.list(activeLearner.id),
    api.groups.list(),
  ]);
  const groupById = new Map<string, GroupOut>(groups.map((g) => [g.id, g]));

  async function startNewPractice() {
    "use server";
    const api2 = await createApi();
    const session = await api2.sessions.create(activeLearner.id);
    revalidatePath("/chat");
    redirect(`/${locale}/chat/${session.id}`);
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <header className="mb-6 flex items-baseline justify-between">
        <h1 className="text-xl font-medium">
          {t("home_title", { name: activeLearner.name })}
        </h1>
        <Link
          href="/parent/learners"
          className="text-muted-foreground hover:text-primary text-xs transition"
        >
          {t("home_manage_link")}
        </Link>
      </header>

      {sessions.length === 0 ? (
        <div className="border-border rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground mb-6 text-sm">{t("no_sessions_yet")}</p>
          <form action={startNewPractice}>
            <button
              type="submit"
              className="bg-primary text-primary-foreground rounded-md px-5 py-2 text-sm transition hover:opacity-90"
            >
              {t("start_first_practice")}
            </button>
          </form>
        </div>
      ) : (
        <>
          <ul className="space-y-2">
            {sessions.map((s) => (
              <SessionCard
                key={s.id}
                session={s}
                group={s.group_id ? groupById.get(s.group_id) ?? null : null}
                relative={fmtRelative(s.updated_at, locale)}
                fallback_title={t("session_title_pending")}
                free_practice_label={t("scope_free_practice_short")}
              />
            ))}
          </ul>
          <form action={startNewPractice} className="mt-6">
            <button
              type="submit"
              className="border-border hover:border-primary flex w-full items-center justify-center gap-2 rounded-md border px-4 py-3 text-sm transition"
            >
              + {t("start_new_practice")}
            </button>
          </form>
        </>
      )}
    </div>
  );
}

function SessionCard({
  session,
  group,
  relative,
  fallback_title,
  free_practice_label,
}: {
  session: SessionOut;
  group: GroupOut | null;
  relative: string;
  fallback_title: string;
  free_practice_label: string;
}) {
  const emoji = group ? KIND_EMOJI[group.kind] : FREE_EMOJI;
  const scopeLabel = group ? group.name : free_practice_label;

  return (
    <li>
      <Link
        href={`/chat/${session.id}`}
        className="border-border hover:border-primary flex items-center gap-3 rounded-md border px-3 py-2.5 transition"
      >
        <span aria-hidden className="text-lg">
          {emoji}
        </span>
        <div className="flex-1 min-w-0">
          <div className="truncate text-sm font-medium">
            {session.title ?? fallback_title}
          </div>
          <div className="text-muted-foreground truncate text-xs">{scopeLabel}</div>
        </div>
        <span className="text-muted-foreground text-xs">{relative}</span>
      </Link>
    </li>
  );
}
