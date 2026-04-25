import { cookies } from "next/headers";
import { backend } from "@/lib/backend";
import { LearnerClient } from "./LearnerClient";
import Link from "next/link";

export default async function LearnersPage() {
  const jar = await cookies();
  const session = jar.get("session")?.value;
  const headers = session ? { Cookie: `session=${session}` } : undefined;

  const learners = await backend.learners.list(headers);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/parent" className="text-muted-foreground hover:text-primary transition">
          &larr; 返回
        </Link>
        <h1 className="text-xl font-medium">孩子管理</h1>
      </div>
      
      <LearnerClient learners={learners} />
    </div>
  );
}
