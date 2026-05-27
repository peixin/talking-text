import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { createApi } from "@/lib/api";
import { GroupDetailClient } from "./GroupDetailClient";

interface Props {
  params: Promise<{
    locale: string;
    groupId: string;
  }>;
}

export default async function GroupDetailPage({ params }: Props) {
  const { groupId } = await params;
  const t = await getTranslations("Materials");
  const api = await createApi();

  // Fetch details of the current material group
  const group = await api.groups.get(groupId);
  // Fetch all groups so we can offer them in the parent selection dropdown
  const allGroups = await api.groups.list(true);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <header className="mb-2 flex items-center gap-4">
        <Link
          href="/parent/materials"
          className="text-muted-foreground hover:text-primary text-sm transition"
        >
          ← {t("back_to_list", { defaultValue: "返回列表" })}
        </Link>
      </header>
      <div className="mb-6 flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{group.name}</h1>
        <p className="text-muted-foreground text-sm">
          {t("detail_subtitle", { defaultValue: "精细化管理和编辑该学习素材的学习点及层级关联" })}
        </p>
      </div>

      <GroupDetailClient group={group} allGroups={allGroups} />
    </div>
  );
}
