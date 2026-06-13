import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/routing";
import { EmptyState } from "@/components/EmptyState";
import { BackendError, backend, type SharePreviewOut } from "@/lib/backend";
import { ShareLandingClient } from "./ShareLandingClient";

/**
 * Landing page for a material share link (docs/learner-content-scope.md UC-5).
 * The receiving parent previews the shared book, then chooses subscribe (live
 * reference, owner's edits propagate) or clone (independent copy).
 */
export default async function ShareLandingPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const t = await getTranslations("ShareLanding");

  let preview: SharePreviewOut | null = null;
  try {
    preview = await backend.share.preview(code);
  } catch (e) {
    if (!(e instanceof BackendError && e.status === 404)) throw e;
  }

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-10">
      <header className="mb-6">
        <Link
          href="/parent/materials"
          className="text-muted-foreground hover:text-primary text-sm transition"
        >
          ← {t("back_to_materials")}
        </Link>
      </header>

      {preview ? (
        <ShareLandingClient code={code} preview={preview} />
      ) : (
        <EmptyState className="rounded-2xl p-10">
          <span className="block font-semibold">{t("not_found_title")}</span>
          <span className="mt-1 block text-xs">{t("not_found_hint")}</span>
        </EmptyState>
      )}
    </div>
  );
}
