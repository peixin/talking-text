"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { backend } from "@/lib/backend";

async function getHeaders() {
  const jar = await cookies();
  const session = jar.get("session")?.value;
  return session ? { Cookie: `session=${session}` } : undefined;
}

export async function createLearner(formData: FormData) {
  const name = String(formData.get("name") ?? "");
  if (!name.trim()) return { error: "名称不能为空" };

  try {
    await backend.learners.create(name, await getHeaders());
    revalidatePath("/parent/learners");
    revalidatePath("/chat");
    return { success: true };
  } catch (e: any) {
    return { error: e.detail || "添加失败" };
  }
}

export async function updateLearner(id: string, formData: FormData) {
  const name = String(formData.get("name") ?? "");
  if (!name.trim()) return { error: "名称不能为空" };

  try {
    await backend.learners.update(id, name, await getHeaders());
    revalidatePath("/parent/learners");
    revalidatePath("/chat");
    return { success: true };
  } catch (e: any) {
    return { error: e.detail || "修改失败" };
  }
}

export async function deleteLearner(id: string) {
  try {
    await backend.learners.delete(id, await getHeaders());
    revalidatePath("/parent/learners");
    revalidatePath("/chat");
    return { success: true };
  } catch (e: any) {
    return { error: e.detail || "删除失败" };
  }
}
