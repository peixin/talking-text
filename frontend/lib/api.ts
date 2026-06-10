import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";

import { BackendError, backend } from "@/lib/backend";
import type {
  GroupCreateBody,
  GroupUpdateBody,
  UpdatePersonaBody,
  SyncPersonaBody,
} from "@/lib/backend";

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
      create: (name: string, cefrLevel?: string | null) =>
        c((h) => backend.learners.create(name, cefrLevel, h)),
      update: (id: string, name: string) => c((h) => backend.learners.update(id, name, h)),
      delete: (id: string) => c((h) => backend.learners.delete(id, h)),
      setActive: (id: string) => c((h) => backend.learners.setActive(id, h)),
      updatePersona: (id: string, body: UpdatePersonaBody) =>
        c((h) => backend.learners.updatePersona(id, body, h)),
      syncPersona: (id: string, body: SyncPersonaBody) =>
        c((h) => backend.learners.syncPersona(id, body, h)),
      weeklyReport: (id: string) => c((h) => backend.learners.weeklyReport(id, h)),
    },
    groups: {
      list: (includeArchived?: boolean) => c((h) => backend.groups.list(includeArchived, h)),
      get: (id: string, recursive?: boolean) => c((h) => backend.groups.get(id, recursive, h)),
      create: (body: GroupCreateBody) => c((h) => backend.groups.create(body, h)),
      update: (id: string, body: GroupUpdateBody) => c((h) => backend.groups.update(id, body, h)),
      delete: (id: string) => c((h) => backend.groups.delete(id, h)),
      listLearners: (groupId: string) => c((h) => backend.groups.listLearners(groupId, h)),
      assignLearner: (groupId: string, learnerId: string) =>
        c((h) => backend.groups.assignLearner(groupId, learnerId, h)),
      unassignLearner: (groupId: string, learnerId: string) =>
        c((h) => backend.groups.unassignLearner(groupId, learnerId, h)),
    },
    ingest: {
      extract: (formData: FormData) => c((h) => backend.ingest.extract(formData, h)),
    },
    organize: {
      inbox: () => c((h) => backend.organize.inbox(h)),
      file: (body: import("./backend").FileItemBody) => c((h) => backend.organize.file(body, h)),
      dismiss: (groupId: string, itemId: string) =>
        c((h) => backend.organize.dismiss(groupId, itemId, h)),
      suggestBag: (groupId: string) => c((h) => backend.organize.suggestBag(groupId, h)),
      fileBag: (
        sourceGroupId: string,
        tagPath: string[],
        levelTitles?: string[] | null,
        sourceRawText?: string | null,
      ) =>
        c((h) => backend.organize.fileBag(sourceGroupId, tagPath, levelTitles, sourceRawText, h)),
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
