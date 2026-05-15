import { getTranslations } from "next-intl/server";
import { createApi } from "@/lib/api";
import CollectionListClient from "./CollectionListClient";

export default async function CollectionsPage() {
  const api = await createApi();
  const learners = await api.learners.list();

  return <CollectionListClient learners={learners} />;
}
