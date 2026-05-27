import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { createApi } from "@/lib/api";
import { GroupItemsClient } from "./GroupItemsClient";

interface Props {
  params: Promise<{
    locale: string;
    groupId: string;
  }>;
}

export default async function GroupItemsPage({ params }: Props) {
  const { groupId } = await params;
  const t = await getTranslations("Materials");
  const api = await createApi();

  // Fetch details of the current material group
  const group = await api.groups.get(groupId);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <header className="mb-2 flex items-center gap-4">
        <Link
          href={`/parent/materials/${groupId}`}
          className="text-muted-foreground hover:text-primary text-sm transition"
        >
          ← {t("back_to_detail", { defaultValue: "返回教材信息" })}
        </Link>
      </header>
      <div className="mb-6 flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{group.name} - 重点词句编辑</h1>
        <p className="text-muted-foreground text-sm">
          专为该素材定制的详细词表与核心句式管理器。所有的单词、短语和句型修改在这里统一保存。
        </p>
      </div>

      <GroupItemsClient group={group} />
    </div>
  );
}
