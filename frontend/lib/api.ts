import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";

import { BackendError, backend } from "@/lib/backend";
import type { GroupCreateBody, UpdatePersonaBody, SyncPersonaBody } from "@/lib/backend";

async function buildHeaders(): Promise<HeadersInit> {
  const jar = await cookies();
  const token = jar.get("session")?.value;
  return token ? { Cookie: `session=${token}` } : {};
}

async function redirectOnExpiry(): Promise<never> {
  const locale = await getLocale();
  redirect(`/${locale}/login?expired=1`);
}

function wrap<T>(headers: HeadersInit, fn: (h: HeadersInit) => Promise<T>): Promise<T> {
  return fn(headers).catch(async (err) => {
    if (err instanceof BackendError && err.status === 401) {
      await redirectOnExpiry();
    }
    throw err;
  });
}

export async function createApi() {
  const h = await buildHeaders();
  const c = <T>(fn: (h: HeadersInit) => Promise<T>) => wrap(h, fn);

  return {
    auth: {
      me: () => c((h) => backend.auth.me(h)),
      logout: () => c((h) => backend.auth.logout(h)),
    },
    learners: {
      list: () => c((h) => backend.learners.list(h)),
      create: (name: string) => c((h) => backend.learners.create(name, h)),
      update: (id: string, name: string) => c((h) => backend.learners.update(id, name, h)),
      delete: (id: string) => c((h) => backend.learners.delete(id, h)),
      setActive: (id: string) => c((h) => backend.learners.setActive(id, h)),
      updatePersona: (id: string, body: UpdatePersonaBody) =>
        c((h) => backend.learners.updatePersona(id, body, h)),
      syncPersona: (id: string, body: SyncPersonaBody) =>
        c((h) => backend.learners.syncPersona(id, body, h)),
    },
    groups: {
      list: () => c((h) => backend.groups.list(h)),
      create: (body: GroupCreateBody) => c((h) => backend.groups.create(body, h)),
    },
    ingest: {
      extract: (formData: FormData) => c((h) => backend.ingest.extract(formData, h)),
    },
    sessions: {
      list: (learnerId: string) => c((h) => backend.sessions.list(learnerId, h)),
      create: (learnerId: string, groupId?: string | null) =>
        c((h) => backend.sessions.create(learnerId, groupId, h)),
      rename: (id: string, title: string) => c((h) => backend.sessions.rename(id, title, h)),
      setGroup: (sessionId: string, groupId: string | null) =>
        c((h) => backend.sessions.setGroup(sessionId, groupId, h)),
      delete: (id: string) => c((h) => backend.sessions.delete(id, h)),
      turns: (id: string) => c((h) => backend.sessions.turns(id, h)),
      getTurnAudio: (sessionId: string, turnId: string, dir: "in" | "out") =>
        c((h) => backend.sessions.getTurnAudio(sessionId, turnId, dir, h)),
    },
  };
}
