import { Link } from "@/i18n/routing";
import { createApi } from "@/lib/api";
import { OrganizeWorkbenchClient } from "./OrganizeWorkbenchClient";

// Organize workbench — docs/content-lifecycle.md §4.
// Left: the active learner's inbox (capture bags + practice-derived candidates).
// Right: the canonical tag tree. Filing MOVES a loose word into a tag node.
export default async function OrganizePage() {
  const api = await createApi();
  const [inbox, groups] = await Promise.all([api.organize.inbox(), api.groups.list(false)]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <header className="mb-2 flex items-center gap-4">
        <Link
          href="/parent/materials"
          className="text-muted-foreground hover:text-primary text-sm transition"
        >
          ← 返回教材
        </Link>
      </header>
      <h1 className="mb-1 text-xl font-medium">整理素材</h1>
      <p className="text-muted-foreground mb-6 text-sm">
        把左侧的散件（采集袋的词、练习里冒出的新词）归位到右侧的教材标签树。归位即从采集袋移走。
      </p>

      <OrganizeWorkbenchClient initialInbox={inbox} groups={groups} />
    </div>
  );
}
