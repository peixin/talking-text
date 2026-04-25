import { cookies } from "next/headers";
import Link from "next/link";
import { backend } from "@/lib/backend";
import { ChatClient } from "./ChatClient";

export default async function ChatPage() {
  const jar = await cookies();
  const session = jar.get("session")?.value;
  const headers = session ? { Cookie: `session=${session}` } : undefined;

  const learners = await backend.learners.list(headers);

  if (learners.length === 0) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center justify-center py-20 text-center">
        <h2 className="mb-4 text-xl font-medium">还没有添加学习者</h2>
        <p className="text-muted-foreground mb-8">请先在家长后台添加孩子信息，然后再开始对话。</p>
        <Link 
          href="/parent/learners"
          className="bg-primary text-primary-foreground rounded-md px-6 py-2 transition hover:opacity-90"
        >
          去添加孩子
        </Link>
      </div>
    );
  }

  const account = await backend.auth.me(headers);
  const activeLearnerId = account.last_active_learner_id;
  let activeLearner = learners.find((l) => l.id === activeLearnerId);
  if (!activeLearner) {
    activeLearner = learners[0];
  }

  const initialHistory: { role: "user" | "assistant"; text: string }[] = [];
  return <ChatClient initialHistory={initialHistory} activeLearner={activeLearner} learners={learners} />;
}
