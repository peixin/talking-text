"use server";

import { cookies } from "next/headers";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/routing";

import { backend } from "@/lib/backend";

const COOKIE_NAME = "session";

export async function logout(): Promise<void> {
  // Tell the Python backend to clear its cookie (best-effort)
  try {
    const jar = await cookies();
    const token = jar.get(COOKIE_NAME)?.value;
    if (token) {
      await backend.auth.logout({ Cookie: `${COOKIE_NAME}=${token}` });
    }
  } catch {
    // Proceed with client-side cookie deletion regardless
  }

  const jar = await cookies();
  jar.delete(COOKIE_NAME);
  
  const locale = await getLocale();
  redirect({ href: "/login", locale });
}
