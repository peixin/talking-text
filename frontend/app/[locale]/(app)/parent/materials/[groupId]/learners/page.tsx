import { getTranslations } from "next-intl/server";
import { createApi } from "@/lib/api";
import { notFound, redirect } from "next/navigation";
import { Link } from "@/i18n/routing";
import { GroupLearnerAssignClient } from "./GroupLearnerAssignClient";

interface Props {
  params: Promise<{
    locale: string;
    groupId: string;
  }>;
}

export default async function GroupLearnerAssignPage({ params }: Props) {
  const { groupId } = await params;
  const t = await getTranslations("Materials");
  const api = await createApi();

  const [group, allLearners] = await Promise.all([
    api.groups.get(groupId).catch(() => null),
    api.learners.list().catch(() => []),
  ]);

  if (!group) notFound();

  // Only root groups support learner assignment
  if (group.parent_id !== null && group.parent_id !== undefined) {
    // Non-root group: redirect to parent group's assignments page
    const allGroups = await api.groups.list(true).catch(() => []);
    const parentNode = allGroups.find((g) => g.id === group.parent_id);
    if (!parentNode) {
      const { locale } = await params;
      redirect(`/${locale}/parent/materials/${group.parent_id}/learners`);
    }
    let currGroup = parentNode;
    while (currGroup.parent_id) {
      const parent = allGroups.find((g) => g.id === currGroup.parent_id);
      if (!parent) break;
      currGroup = parent;
    }
    const { locale } = await params;
    redirect(`/${locale}/parent/materials/${currGroup.id}/learners`);
  }

  // Fetch which learners are already assigned to this group
  let assignedLearnerIds: string[] = [];
  try {
    const assignments = await api.groups.listLearners(groupId);
    assignedLearnerIds = assignments.map((a: { learner_id: string }) => a.learner_id);
  } catch {
    // API not yet implemented; gracefully degrade to empty list
    assignedLearnerIds = [];
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-8">
      <header className="mb-6 flex items-center gap-4">
        <Link
          href={`/parent/materials/${groupId}`}
          className="text-muted-foreground hover:text-primary text-sm transition"
        >
          {t("back_to_group")}
        </Link>
      </header>

      <div className="mb-6 flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t("assign_learner_title")}</h1>
        <p className="text-muted-foreground text-sm">
          {t("assign_learner_subtitle", { name: group.name })}
        </p>
      </div>

      <GroupLearnerAssignClient
        groupId={groupId}
        groupName={group.name}
        allLearners={allLearners}
        initialAssignedIds={assignedLearnerIds}
      />
    </div>
  );
}
