import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/routing";
import { createApi } from "@/lib/api";
import { OrganizeWorkbenchClient } from "./OrganizeWorkbenchClient";

// Organize workbench — docs/content-lifecycle.md §4.
// Left: the active learner's inbox (capture bags + practice-derived candidates).
// Right: the canonical tag tree. Filing MOVES a loose word into a tag node.
export default async function OrganizePage() {
  const t = await getTranslations("Organize");
  const api = await createApi();
  const [inbox, groups] = await Promise.all([api.organize.inbox(), api.groups.list(false)]);

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-8">
      <header className="mb-2 flex items-center gap-4">
        <Link
          href="/parent/materials"
          className="text-muted-foreground hover:text-primary text-sm transition"
        >
          ← {t("back_to_materials")}
        </Link>
      </header>
      <h1 className="mb-1 text-xl font-medium">{t("title")}</h1>
      <p className="text-muted-foreground mb-6 text-sm">{t("subtitle")}</p>

      <OrganizeWorkbenchClient initialInbox={inbox} groups={groups} />
    </div>
  );
}
