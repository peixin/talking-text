"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { BackendError, backend } from "@/lib/backend";

const COOKIE_NAME = "session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // must match config.toml [auth] session_max_age_days

export type RegisterState = { error: string } | null;

export async function register(
  _prevState: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const name = String(formData.get("name") ?? "");
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  let sessionToken: string | undefined;
  try {
    const result = await backend.auth.register(name, email, password);
    sessionToken = result.session_token;
  } catch (e) {
    if (e instanceof BackendError && e.status === 409) {
      return { error: "该邮箱已被注册" };
    }
    return { error: "服务器错误，请稍后再试" };
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

  redirect("/chat");
}
