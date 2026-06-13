import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/routing";
import { createApi } from "@/lib/api";
import { LearnerOut } from "@/lib/backend";
import { MaterialsClient } from "./MaterialsClient";

export default async function MaterialsPage() {
  const t = await getTranslations("Materials");
  const api = await createApi();
  const [groups, subscriptions, allLearners] = await Promise.all([
    api.groups.list(true), // include archived
    api.share.listSubscriptions(),
    api.learners.list().catch(() => [] as LearnerOut[]),
  ]);

  // Build learner lookup map: id → LearnerOut
  const learnerById = new Map<string, LearnerOut>(allLearners.map((l) => [l.id, l]));

  // Fetch learner assignments for root-level, non-archived groups in parallel
  const rootGroups = groups.filter((g) => !g.archived && g.parent_id === null);

  const assignmentResults = await Promise.all(
    rootGroups.map(async (g) => {
      try {
        const assignments = await api.groups.listLearners(g.id);
        const learners = assignments
          .map((a) => learnerById.get(a.learner_id))
          .filter((l): l is LearnerOut => l !== undefined);
        return { groupId: g.id, learners };
      } catch {
        return { groupId: g.id, learners: [] as LearnerOut[] };
      }
    }),
  );

  // Map: groupId → array of {id, name} for each assigned learner
  const rootBookLearners: Record<string, { id: string; name: string }[]> = {};
  for (const r of assignmentResults) {
    if (r.learners.length > 0) {
      rootBookLearners[r.groupId] = r.learners.map((l) => ({ id: l.id, name: l.name }));
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-8">
      <header className="mb-2 flex items-center gap-4">
        <Link
          href="/parent"
          className="text-muted-foreground hover:text-primary text-sm transition"
        >
          ← {t("back_to_parent")}
        </Link>
        <Link
          href="/parent/organize"
          className="text-primary hover:text-primary/80 ml-auto text-sm transition"
        >
          {t("organize_link")}
        </Link>
      </header>
      <h1 className="mb-1 text-xl font-medium">{t("title")}</h1>
      <p className="text-muted-foreground mb-6 text-sm">{t("subtitle")}</p>

      <MaterialsClient
        groups={groups}
        subscriptions={subscriptions}
        allLearners={allLearners}
        rootBookLearners={rootBookLearners}
      />
    </div>
  );
}
