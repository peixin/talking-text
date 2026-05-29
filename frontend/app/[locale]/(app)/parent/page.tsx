import { getTranslations } from "next-intl/server";
import { BookOpen, FolderInput, MessageSquare, Settings, Sparkles, Users } from "lucide-react";

import { createApi } from "@/lib/api";
import { Link } from "@/i18n/routing";

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
  const materialsCount = groups.filter(
    (g) => !g.archived && g.parent_id === null && g.kind !== "quick_practice",
  ).length;
  const pendingBags = inbox.capture_bags.length;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("welcome", { name: account.name })}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          字有天地 · 言出成界 — 在孩子已学的范围里陪他开口。
        </p>
      </div>

      {/* Active learner */}
      <div className="border-border bg-card mb-6 flex items-center justify-between rounded-xl border p-4">
        <div className="flex items-center gap-3">
          <span className="bg-primary/10 text-primary flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold">
            {(activeLearner?.name ?? "?").slice(0, 1)}
          </span>
          <div>
            <div className="text-muted-foreground text-[11px]">当前学习者</div>
            <div className="text-sm font-medium">{activeLearner?.name ?? "未选择"}</div>
          </div>
        </div>
        <Link href="/parent/learners" className="text-primary text-sm hover:underline">
          {learners.length > 0 ? "切换 / 管理" : t("go_add")}
        </Link>
      </div>

      {/* Learning flow — capture → organize → chat */}
      <h2 className="mb-3 text-sm font-semibold">学习流程</h2>
      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <FlowCard
          href="/parent/materials"
          icon={<BookOpen className="h-5 w-5 text-indigo-500" />}
          title="录入教材"
          desc="拍照 / 粘贴，AI 提取单词与句型"
          badge={`${materialsCount} 本教材`}
        />
        <FlowCard
          href="/parent/organize"
          icon={<FolderInput className="h-5 w-5 text-amber-500" />}
          title="整理素材"
          desc="把采集的词归位成教材标签树，AI 已预判"
          badge={pendingBags > 0 ? `${pendingBags} 袋待整理` : "已清空"}
          highlight={pendingBags > 0}
        />
        <FlowCard
          href="/chat"
          icon={<MessageSquare className="h-5 w-5 text-emerald-500" />}
          title="开始对话"
          desc="在已学范围里陪孩子开口说"
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
          <div className="border-border rounded-xl border border-dashed p-6 text-center">
            <p className="text-muted-foreground mb-4 text-sm">{t("no_children")}</p>
            <Link
              href="/parent/learners"
              className="bg-primary text-primary-foreground rounded px-4 py-2 text-sm transition"
            >
              {t("go_add")}
            </Link>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {learners.map((learner) => (
              <Link
                key={learner.id}
                href={`/parent/learners/${learner.id}`}
                className="border-border hover:border-primary flex items-center justify-between rounded-xl border p-4 transition"
              >
                <span className="font-medium">{learner.name}</span>
                {account.last_active_learner_id === learner.id && (
                  <span className="bg-primary/10 text-primary rounded px-2 py-1 text-xs font-medium">
                    {t("last_used")}
                  </span>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Secondary */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/parent/learners"
          className="border-border hover:border-primary flex items-start gap-3 rounded-xl border p-4 transition"
        >
          <Settings className="text-muted-foreground mt-0.5 h-4 w-4" />
          <div>
            <div className="text-sm font-medium">{t("child_management")}</div>
            <div className="text-muted-foreground text-xs">{t("child_management_desc")}</div>
          </div>
        </Link>
        <div className="border-border flex items-start gap-3 rounded-xl border p-4 opacity-50">
          <Sparkles className="text-muted-foreground mt-0.5 h-4 w-4" />
          <div>
            <div className="text-sm font-medium">{t("learning_progress")}</div>
            <div className="text-muted-foreground text-xs">掌握度追踪（即将上线）</div>
          </div>
        </div>
      </div>
    </div>
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
          ? "border-amber-300 bg-amber-50/50 hover:border-amber-400"
          : "border-border hover:border-primary")
      }
    >
      <div className="mb-2 flex items-center justify-between">
        {icon}
        {badge && (
          <span
            className={
              "rounded-full px-2 py-0.5 text-[10px] font-medium " +
              (highlight ? "bg-amber-200 text-amber-800" : "bg-muted text-muted-foreground")
            }
          >
            {badge}
          </span>
        )}
      </div>
      <div className="text-sm font-semibold">{title}</div>
      <div className="text-muted-foreground mt-0.5 text-xs">{desc}</div>
    </Link>
  );
}
