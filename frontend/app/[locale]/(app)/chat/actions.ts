"use server";

import { cookies } from "next/headers";
import { backend } from "@/lib/backend";

export async function setActiveLearner(learnerId: string) {
  const jar = await cookies();
  const session = jar.get("session")?.value;
  const headers = session ? { Cookie: `session=${session}` } : undefined;
  
  await backend.learners.setActive(learnerId, headers);
}
