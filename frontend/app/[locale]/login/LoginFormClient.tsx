"use client";

import { useActionState } from "react";
import { Link } from "@/i18n/routing";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

import { type LoginState, login } from "./actions";

export default function LoginFormClient() {
  const t = useTranslations("Auth");
  const [state, action, isPending] = useActionState<LoginState, FormData>(login, null);

  // Translate error codes returned from server action
  const errorMessage = state?.error
    ? t.has(`errors.${state.error}`)
      ? t(`errors.${state.error}` as Parameters<typeof t>[0])
      : state.error
    : null;

  return (
    <form action={action} className="flex w-full max-w-sm flex-col gap-4">
      <h1 className="mb-2 text-2xl font-semibold">{t("login_action")}</h1>

      {errorMessage && (
        <p className="text-destructive rounded-md bg-destructive/10 px-3 py-2 text-sm">
          {errorMessage}
        </p>
      )}

      <input
        name="email"
        type="email"
        placeholder={t("email_placeholder")}
        required
        className="border-input bg-background focus:ring-ring rounded-lg border px-3 py-2 text-sm transition outline-none focus:ring-2"
      />
      <input
        name="password"
        type="password"
        placeholder={t("password_placeholder")}
        required
        className="border-input bg-background focus:ring-ring rounded-lg border px-3 py-2 text-sm transition outline-none focus:ring-2"
      />
      <Button type="submit" disabled={isPending}>
        {isPending ? t("logging_in") : t("login_action")}
      </Button>

      <p className="text-muted-foreground text-center text-sm">
        {t("no_account")}{" "}
        <Link href="/register" className="text-primary underline-offset-4 hover:underline">
          {t("register")}
        </Link>
      </p>
    </form>
  );
}
