import { getTranslations } from "next-intl/server";
import { BookOpen, FolderInput, MessageSquare, Sparkles, Users } from "lucide-react";

import { createApi } from "@/lib/api";
import { Link } from "@/i18n/routing";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/EmptyState";
import { Panel } from "@/components/Panel";
import type { WeeklyReportOut } from "@/lib/backend";

export default async function ParentDashboard() {
  const t = await getTranslations("Parent");
  const api = await createApi();
  const [account, learners, groups, inbox] = await Promise.all([
    api.auth.me(),
    api.learners.list(),
    api.groups.list(false),
    api.organize.inbox(),
  ]);

  const activeLearner = learners.find((l) => l.id === account.last_active_learner_id) ?? null;
  const report = activeLearner ? await api.learners.weeklyReport(activeLearner.id) : null;
  const materialsCount = groups.filter(
    (g) => !g.archived && g.parent_id === null && g.kind !== "quick_practice",
  ).length;
  const pendingBags = inbox.capture_bags.length;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("welcome", { name: account.name })}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t("tagline")}</p>
      </div>

      {/* Active learner */}
      <Panel className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="bg-primary/10 text-primary flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold">
            {(activeLearner?.name ?? "?").slice(0, 1)}
          </span>
          <div>
            <div className="text-muted-foreground text-[11px]">{t("active_learner_label")}</div>
            <div className="text-sm font-medium">
              {activeLearner?.name ?? t("no_learner_selected")}
            </div>
          </div>
        </div>
        <Link href="/parent/learners" className="text-primary text-sm hover:underline">
          {learners.length > 0 ? t("switch_manage") : t("go_add")}
        </Link>
      </Panel>

      {/* Learning flow — capture → organize → chat */}
      <h2 className="mb-3 text-sm font-semibold">{t("learning_flow")}</h2>
      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <FlowCard
          href="/parent/materials"
          icon={<BookOpen className="text-primary h-5 w-5" />}
          title={t("flow_ingest_title")}
          desc={t("flow_ingest_desc")}
          badge={t("flow_ingest_badge", { count: materialsCount })}
        />
        <FlowCard
          href="/parent/organize"
          icon={<FolderInput className="text-warning h-5 w-5" />}
          title={t("flow_organize_title")}
          desc={t("flow_organize_desc")}
          badge={
            pendingBags > 0
              ? t("flow_organize_badge", { count: pendingBags })
              : t("flow_organize_badge_empty")
          }
          highlight={pendingBags > 0}
        />
        <FlowCard
          href="/chat"
          icon={<MessageSquare className="text-success h-5 w-5" />}
          title={t("flow_chat_title")}
          desc={t("flow_chat_desc")}
        />
      </div>

      {/* Children */}
      <div className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <Users className="h-4 w-4" /> {t("my_children")}
          </h2>
          <Link href="/parent/learners" className="text-primary text-sm hover:underline">
            {t("manage_add")}
          </Link>
        </div>

        {learners.length === 0 ? (
          <EmptyState
            action={
              <Link
                href="/parent/learners"
                className="bg-primary text-primary-foreground rounded px-4 py-2 text-sm transition"
              >
                {t("go_add")}
              </Link>
            }
          >
            {t("no_children")}
          </EmptyState>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {learners.map((learner) => (
              <Link
                key={learner.id}
                href={`/parent/learners/${learner.id}`}
                className="border-border hover:border-primary flex items-center justify-between rounded-xl border p-4 transition"
              >
                <div>
                  <div className="font-medium">{learner.name}</div>
                  <div className="text-muted-foreground mt-0.5 text-xs">
                    {t("learner_card_hint")}
                  </div>
                </div>
                {account.last_active_learner_id === learner.id && (
                  <Badge className="bg-primary/10 text-primary h-auto rounded py-1">
                    {t("last_used")}
                  </Badge>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Weekly report — new words the child produced (roadmap Phase 2) */}
      {activeLearner && report && (
        <div className="mb-8">
          <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
            <Sparkles className="h-4 w-4" /> {t("report_title")}
          </h2>
          <WeeklyReportCard report={report} learnerName={activeLearner.name} />
        </div>
      )}
    </div>
  );
}

const TAG_STYLES: Record<string, string> = {
  stretch: "border-warning/50 bg-warning/15 text-warning",
  curriculum: "border-border bg-muted text-foreground",
  wild: "border-primary/30 bg-primary/10 text-primary",
};

// Legend dots need saturated fills — the pale chip backgrounds are
// indistinguishable at 2px.
const TAG_DOT_STYLES: Record<string, string> = {
  stretch: "bg-warning",
  curriculum: "bg-muted-foreground",
  wild: "bg-primary",
};

async function WeeklyReportCard({
  report,
  learnerName,
}: {
  report: WeeklyReportOut;
  learnerName: string;
}) {
  const t = await getTranslations("Parent");
  const tags = ["stretch", "curriculum", "wild"] as const;
  const present = tags.filter((tag) => report.new_words.some((w) => w.tag === tag));

  return (
    <Panel>
      <p className="text-muted-foreground mb-3 text-xs">
        {t("report_desc", { name: learnerName })}
      </p>
      {report.new_words.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("report_empty")}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {report.new_words.map((w) => (
              <span
                key={w.text}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-sm ${TAG_STYLES[w.tag]}`}
              >
                {w.text}
                {w.count > 1 && <span className="text-[10px] opacity-60">×{w.count}</span>}
              </span>
            ))}
          </div>
          {present.length > 0 && (
            <div className="text-muted-foreground mt-3 flex gap-3 text-[11px]">
              {present.map((tag) => (
                <span key={tag} className="inline-flex items-center gap-1">
                  <span
                    className={`inline-block h-2.5 w-2.5 rounded-full ${TAG_DOT_STYLES[tag]}`}
                  />
                  {t(`report_tag_${tag}`)}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

function FlowCard({
  href,
  icon,
  title,
  desc,
  badge,
  highlight,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
  badge?: string;
  highlight?: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        "group flex flex-col rounded-xl border p-4 transition " +
        (highlight
          ? "border-warning/50 bg-warning/10 hover:border-warning"
          : "border-border hover:border-primary")
      }
    >
      <div className="mb-2 flex items-center justify-between">
        {icon}
        {badge && (
          <Badge
            className={
              "h-auto rounded-full text-[10px] " +
              (highlight ? "bg-warning/20 text-warning" : "bg-muted text-muted-foreground")
            }
          >
            {badge}
          </Badge>
        )}
      </div>
      <div className="text-sm font-semibold">{title}</div>
      <div className="text-muted-foreground mt-0.5 text-xs">{desc}</div>
    </Link>
  );
}
