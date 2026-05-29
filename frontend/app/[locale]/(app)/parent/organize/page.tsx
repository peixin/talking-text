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
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
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
        每次录入是一袋。AI 已预判它该归到哪个教材标签下 —— 你确认或微调路径，点「整袋归位」即可。
      </p>

      <OrganizeWorkbenchClient initialInbox={inbox} groups={groups} />
    </div>
  );
}
