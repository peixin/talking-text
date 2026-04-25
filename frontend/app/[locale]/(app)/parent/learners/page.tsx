import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { backend } from "@/lib/backend";
import { Link } from "@/i18n/routing";
import { LearnerClient } from "./LearnerClient";

export default async function LearnersPage() {
  const t = await getTranslations("Learners");
  const jar = await cookies();
  const session = jar.get("session")?.value;
  const headers = session ? { Cookie: `session=${session}` } : undefined;

  const learners = await backend.learners.list(headers);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/parent" className="text-muted-foreground hover:text-primary transition">
          &larr; {t("back")}
        </Link>
        <h1 className="text-xl font-medium">{t("page_title")}</h1>
      </div>
      
      <LearnerClient learners={learners} />
    </div>
  );
}
