import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { backend } from "@/lib/backend";
import { Link } from "@/i18n/routing";

export default async function ParentDashboard() {
  const t = await getTranslations("Parent");
  const jar = await cookies();
  const session = jar.get("session")?.value;
  const headers = session ? { Cookie: `session=${session}` } : undefined;

  const [account, learners] = await Promise.all([
    backend.auth.me(headers),
    backend.learners.list(headers),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8 border-b pb-6">
        <h1 className="mb-2 text-2xl font-medium">{t("welcome", { name: account.name })}</h1>
        <p className="text-muted-foreground text-sm">{t("welcome_desc")}</p>
      </div>

      <div className="mb-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-medium">{t("my_children")}</h2>
          <Link href="/parent/learners" className="text-sm text-blue-500 hover:underline">
            {t("manage_add")}
          </Link>
        </div>
        
        {learners.length === 0 ? (
          <div className="border-border rounded-lg border border-dashed p-6 text-center">
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
              <div key={learner.id} className="border-border flex items-center justify-between rounded-lg border p-4">
                <span className="font-medium">{learner.name}</span>
                {account.last_active_learner_id === learner.id && (
                  <span className="bg-primary/10 text-primary rounded px-2 py-1 text-xs font-medium">
                    {t("last_used")}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mb-8">
        <h2 className="mb-4 text-lg font-medium">{t("feature_center")}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Link 
            href="/parent/learners"
            className="border-border hover:border-primary flex flex-col items-start rounded-lg border p-5 transition"
          >
            <span className="font-medium">{t("child_management")}</span>
            <span className="text-muted-foreground mt-1 text-sm">{t("child_management_desc")}</span>
          </Link>
          
          <div className="border-border flex flex-col items-start rounded-lg border p-5 opacity-50">
            <span className="font-medium">{t("material_management")}</span>
            <span className="text-muted-foreground mt-1 text-sm">{t("material_management_desc")}</span>
          </div>
          
          <div className="border-border flex flex-col items-start rounded-lg border p-5 opacity-50">
            <span className="font-medium">{t("learning_progress")}</span>
            <span className="text-muted-foreground mt-1 text-sm">{t("learning_progress_desc")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
