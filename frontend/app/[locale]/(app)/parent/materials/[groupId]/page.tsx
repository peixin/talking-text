import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { createApi } from "@/lib/api";
import { GroupDetailClient } from "./GroupDetailClient";

interface Props {
  params: Promise<{
    locale: string;
    groupId: string;
  }>;
}

export default async function GroupDetailPage({ params }: Props) {
  const { groupId } = await params;
  const t = await getTranslations("Materials");
  const api = await createApi();

  // Fetch details, all groups, and learners in parallel
  const [group, allGroups, allLearners] = await Promise.all([
    api.groups.get(groupId),
    api.groups.list(true),
    api.learners.list().catch(() => []),
  ]);

  // If there is exactly one learner and this is a root group, ensure it's assigned by default
  const isSingleLearner = allLearners.length === 1;
  if (isSingleLearner && !group.parent_id) {
    try {
      const assignments = await api.groups.listLearners(groupId);
      const isAssigned = assignments.some((a) => a.learner_id === allLearners[0].id);
      if (!isAssigned) {
        await api.groups.assignLearner(groupId, allLearners[0].id);
      }
    } catch (e) {
      console.error("Auto-assign failed:", e);
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <header className="mb-2 flex items-center gap-4">
        <Link
          href="/parent/materials"
          className="text-muted-foreground hover:text-primary text-sm transition"
        >
          ← {t("back_to_list", { defaultValue: "返回列表" })}
        </Link>
      </header>
      <div className="mb-6 flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{group.name}</h1>
        <p className="text-muted-foreground text-sm">
          {t("detail_subtitle", { defaultValue: "精细化管理和编辑该学习素材的学习点及层级关联" })}
        </p>
      </div>

      <GroupDetailClient group={group} allGroups={allGroups} learnerCount={allLearners.length} />
    </div>
  );
}
