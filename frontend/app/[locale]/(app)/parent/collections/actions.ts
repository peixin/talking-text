"use server";

import { createApi } from "@/lib/api";

export async function getCollections(learnerId: string) {
  const api = await createApi();
  return api.collections.list(learnerId);
}

export async function getCollectionItems(collectionId: string) {
  const api = await createApi();
  return api.collections.getItems(collectionId);
}

export async function createChatSession(learnerId: string, collectionId: string) {
  const api = await createApi();
  return api.sessions.create(learnerId, null, collectionId);
}
