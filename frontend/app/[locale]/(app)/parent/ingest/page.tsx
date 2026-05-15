import { useTranslations } from "next-intl";
import { createApi } from "@/lib/api";
import IngestClient from "./IngestClient";

export default async function IngestPage() {
  const api = await createApi();
  const learners = await api.learners.list();

  return <IngestClient learners={learners} />;
}
