import { Link } from "@/i18n/routing";
import { createApi } from "@/lib/api";
import { GroupItemsClient } from "../GroupItemsClient";
import { TagPathHeader } from "@/components/TagPathHeader";

interface Props {
  params: Promise<{
    locale: string;
    groupId: string;
  }>;
}

export default async function GroupItemsEditPage({ params }: Props) {
  const { groupId } = await params;
  const api = await createApi();

  // Fetch details and all groups in parallel
  const [group, allGroups] = await Promise.all([api.groups.get(groupId), api.groups.list(true)]);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <header className="mb-2 flex items-center gap-4">
        <Link
          href={`/parent/materials/${groupId}/items`}
          className="text-muted-foreground hover:text-primary text-sm transition"
        >
          ← 返回词句列表
        </Link>
      </header>

      <TagPathHeader
        groupId={group.id}
        groupName={group.name}
        groupKind={group.kind}
        allGroups={allGroups}
        subtitle="专为该素材定制的详细词表与核心句式管理器。所有的单词、短语和句型修改在这里统一保存。"
      />

      <GroupItemsClient group={group} readOnly={false} />
    </div>
  );
}
