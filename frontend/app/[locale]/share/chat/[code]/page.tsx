import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Sparkles } from "lucide-react";

import { Link } from "@/i18n/routing";
import { BackendError, SharedChatOut, backend } from "@/lib/backend";
import { SharedChatClient } from "./SharedChatClient";

export const dynamic = "force-dynamic";

async function getSharedChat(code: string): Promise<SharedChatOut | null> {
  try {
    return await backend.chatShare.getShared(code);
  } catch (e) {
    if (e instanceof BackendError && e.status === 404) return null;
    throw e;
  }
}

export default async function SharedChatPage({
  params,
}: {
  params: Promise<{ locale: string; code: string }>;
}) {
  const { locale, code } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("SharedChat");

  const chat = await getSharedChat(code);
  if (!chat) notFound();

  return (
    <div className="bg-background flex h-[100dvh] flex-col overflow-y-auto">
      {/* Header — brand + session title */}
      <header className="border-border bg-background/80 sticky top-0 z-10 border-b px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <div className="from-primary to-primary/70 text-primary-foreground shadow-primary/20 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr shadow-md">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold">{chat.title || t("default_title")}</h1>
            <p className="text-muted-foreground text-xs">{t("subtitle", { ai: chat.ai_name })}</p>
          </div>
          <Link href="/" className="text-primary shrink-0 text-xs font-medium hover:underline">
            {t("brand_link")}
          </Link>
        </div>
      </header>

      {/* Conversation */}
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
        <SharedChatClient code={code} chat={chat} />
      </main>

      {/* Growth CTA */}
      <footer className="border-border bg-muted/30 border-t px-4 py-8">
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 text-center">
          <p className="text-sm font-medium">{t("cta_title")}</p>
          <p className="text-muted-foreground max-w-md text-xs leading-relaxed">{t("cta_desc")}</p>
          <Link
            href="/register"
            className="bg-primary text-primary-foreground inline-flex items-center justify-center rounded-lg px-6 py-2.5 text-sm font-medium transition hover:opacity-85"
          >
            {t("cta_button")}
          </Link>
        </div>
      </footer>
    </div>
  );
}
