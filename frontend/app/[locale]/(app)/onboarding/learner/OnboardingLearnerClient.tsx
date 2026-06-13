"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { createFirstLearner, type CreateLearnerResult } from "./actions";

const CEFR_OPTIONS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

export function OnboardingLearnerClient() {
  const t = useTranslations("Onboarding");
  const [state, action, isPending] = useActionState<CreateLearnerResult, FormData>(
    createFirstLearner,
    null,
  );

  const errorMessage = state?.error
    ? t.has(`errors.${state.error}`)
      ? t(`errors.${state.error}` as Parameters<typeof t>[0])
      : state.error
    : null;

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-6 py-12">
      <header className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
      </header>

      <form action={action} className="flex flex-col gap-4">
        {errorMessage && (
          <Alert variant="destructive" className="rounded-md border-transparent px-3">
            {errorMessage}
          </Alert>
        )}

        <label className="block">
          <span className="mb-1 block text-sm font-medium">{t("name_label")}</span>
          <input
            name="name"
            type="text"
            placeholder={t("name_placeholder")}
            required
            maxLength={100}
            autoFocus
            className="border-input bg-background focus:ring-ring w-full rounded-lg border px-3 py-2 text-sm transition outline-none focus:ring-2"
          />
        </label>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t("cefr_label")}</legend>
          <p className="text-muted-foreground text-xs">{t("cefr_hint")}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <label className="cursor-pointer">
              <input
                type="radio"
                name="cefr_level"
                value="unknown"
                defaultChecked
                className="peer sr-only"
              />
              <span className="border-input peer-checked:border-primary peer-checked:bg-primary/10 hover:border-foreground/40 inline-block rounded-md border px-3 py-1.5 text-sm transition">
                {t("cefr_unknown")}
              </span>
            </label>
            {CEFR_OPTIONS.map((lvl) => (
              <label key={lvl} className="cursor-pointer">
                <input type="radio" name="cefr_level" value={lvl} className="peer sr-only" />
                <span className="border-input peer-checked:border-primary peer-checked:bg-primary/10 hover:border-foreground/40 inline-block rounded-md border px-3 py-1.5 text-sm transition">
                  {lvl}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <Button type="submit" disabled={isPending} className="mt-2">
          {isPending ? t("creating") : t("create_cta")}
        </Button>
        <p className="text-muted-foreground text-center text-xs">{t("persona_note")}</p>
      </form>
    </main>
  );
}
