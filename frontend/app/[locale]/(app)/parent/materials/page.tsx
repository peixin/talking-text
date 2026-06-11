import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/routing";
import { createApi } from "@/lib/api";
import { MaterialsClient } from "./MaterialsClient";

export default async function MaterialsPage() {
  const t = await getTranslations("Materials");
  const api = await createApi();
  const [groups, subscriptions] = await Promise.all([
    api.groups.list(true), // include archived
    api.share.listSubscriptions(),
  ]);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <header className="mb-2 flex items-center gap-4">
        <Link
          href="/parent"
          className="text-muted-foreground hover:text-primary text-sm transition"
        >
          ← {t("back_to_parent")}
        </Link>
        <Link
          href="/parent/organize"
          className="ml-auto text-sm text-indigo-600 transition hover:text-indigo-700"
        >
          整理素材 →
        </Link>
      </header>
      <h1 className="mb-1 text-xl font-medium">{t("title")}</h1>
      <p className="text-muted-foreground mb-6 text-sm">{t("subtitle")}</p>

      <MaterialsClient groups={groups} subscriptions={subscriptions} />
    </div>
  );
}
