import { getTranslations } from "next-intl/server";
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
  const t = await getTranslations("Materials");
  const api = await createApi();

  // Fetch details and all groups in parallel
  const [group, allGroups] = await Promise.all([api.groups.get(groupId), api.groups.list(true)]);

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <header className="mb-2 flex items-center gap-4">
        <Link
          href={`/parent/materials/${groupId}/items`}
          className="text-muted-foreground hover:text-primary text-sm transition"
        >
          {t("back_to_items_list")}
        </Link>
      </header>

      <TagPathHeader
        groupId={group.id}
        groupName={group.name}
        groupKind={group.kind}
        allGroups={allGroups}
        subtitle={t("items_edit_subtitle")}
      />

      <GroupItemsClient group={group} readOnly={false} />
    </div>
  );
}
