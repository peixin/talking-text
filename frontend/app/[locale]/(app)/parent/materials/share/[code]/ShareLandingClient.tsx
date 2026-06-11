"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { BookOpen, Copy, Loader2, Rss } from "lucide-react";

import { useRouter } from "@/i18n/routing";
import type { AdoptMode, SharePreviewOut } from "@/lib/backend";
import { adoptShareAction } from "../../actions";

export function ShareLandingClient({ code, preview }: { code: string; preview: SharePreviewOut }) {
  const t = useTranslations("ShareLanding");
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<AdoptMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleAdopt(mode: AdoptMode) {
    setError(null);
    setBusy(mode);
    startTransition(async () => {
      const res = await adoptShareAction(code, mode);
      setBusy(null);
      if (res.ok) {
        router.push("/parent/materials");
      } else {
        setError(
          res.error === "CANNOT_ADOPT_OWN_GROUP" ? t("error_own_group") : t("error_adopt_failed"),
        );
      }
    });
  }

  return (
    <div className="space-y-5">
      {/* Book preview card */}
      <div className="bg-card rounded-2xl border p-6 text-center shadow-sm">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50 text-indigo-700">
          <BookOpen className="h-7 w-7" />
        </div>
        <h1 className="text-lg font-bold">{preview.name}</h1>
        <p className="text-muted-foreground mt-1 text-xs">
          {t("from_owner", { name: preview.owner_name })}
        </p>
        <p className="text-muted-foreground mt-3 text-sm">
          {t("contents_summary", {
            items: preview.item_count,
            units: preview.unit_count,
          })}
        </p>
      </div>

      {error && <p className="text-destructive text-center text-sm">{error}</p>}

      {/* Subscribe (default, highlighted) vs clone */}
      <div className="space-y-3">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => handleAdopt("subscribe")}
          className="bg-primary text-primary-foreground w-full rounded-xl p-4 text-left transition hover:opacity-90 disabled:opacity-50"
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            {busy === "subscribe" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Rss className="h-4 w-4" />
            )}
            {t("subscribe_button")}
          </span>
          <span className="mt-1 block text-xs opacity-80">{t("subscribe_desc")}</span>
        </button>

        <button
          type="button"
          disabled={busy !== null}
          onClick={() => handleAdopt("clone")}
          className="border-border bg-card w-full rounded-xl border p-4 text-left transition hover:bg-slate-50 disabled:opacity-50 dark:hover:bg-slate-900"
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            {busy === "clone" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            {t("clone_button")}
          </span>
          <span className="text-muted-foreground mt-1 block text-xs">{t("clone_desc")}</span>
        </button>
      </div>
    </div>
  );
}
