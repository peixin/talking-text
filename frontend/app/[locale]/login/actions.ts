"use server";

import { cookies } from "next/headers";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/routing";

import { BackendError, backend } from "@/lib/backend";

const COOKIE_NAME = "session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // must match config.toml [auth] session_max_age_days

export type LoginState = { error: string } | null;

export async function login(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  let sessionToken: string | undefined;
  try {
    const result = await backend.auth.login(email, password);
    sessionToken = result.session_token;
  } catch (e) {
    if (e instanceof BackendError && e.status === 401) {
      return { error: "AUTH_INVALID_CREDENTIALS" };
    }
    return { error: "AUTH_SERVER_ERROR" };
  }

  if (sessionToken) {
    const jar = await cookies();
    jar.set(COOKIE_NAME, sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: COOKIE_MAX_AGE,
      secure: false,
    });
  }

  const locale = await getLocale();
  redirect({ href: "/chat", locale });
  return null;
}
