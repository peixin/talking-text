import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { logout } from "./actions";
import LocaleSwitcher from "@/components/LocaleSwitcher";
import { Toaster } from "@/components/ui/sonner";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("Navigation");

  return (
    <div className="bg-background flex h-[100dvh] w-full flex-col">
      <header className="border-border flex flex-none items-center justify-between border-b px-3 py-3 sm:px-6 sm:py-4">
        <Link
          href="/"
          className="text-sm font-semibold tracking-wide whitespace-nowrap sm:text-base"
        >
          {t("app_name")}
        </Link>
        <div className="flex items-center gap-2 sm:gap-5">
          <nav className="flex gap-2 text-xs sm:gap-5 sm:text-sm">
            <Link href="/chat" className="hover:text-primary whitespace-nowrap">
              {t("chat")}
            </Link>
            <Link href="/parent" className="hover:text-primary whitespace-nowrap">
              {t("parent")}
            </Link>
          </nav>
          <form action={logout}>
            <button
              type="submit"
              className="text-muted-foreground hover:text-primary text-xs whitespace-nowrap transition sm:mr-4 sm:text-sm"
            >
              {t("logout")}
            </button>
          </form>
          <LocaleSwitcher />
        </div>
      </header>
      <main className="flex min-h-0 w-full flex-1 flex-col">{children}</main>
      <Toaster position="top-center" richColors />
    </div>
  );
}
