import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { logout } from "./actions";
import LocaleSwitcher from "@/components/LocaleSwitcher";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("Navigation");

  return (
    <div className="flex flex-col w-full h-[100dvh] bg-background">
      <header className="flex-none border-border flex items-center justify-between border-b px-3 py-3 sm:px-6 sm:py-4">
        <Link href="/" className="whitespace-nowrap text-sm font-semibold tracking-wide sm:text-base">
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
            <button type="submit" className="text-muted-foreground hover:text-primary whitespace-nowrap text-xs transition sm:mr-4 sm:text-sm">
              {t("logout")}
            </button>
          </form>
          <LocaleSwitcher />
        </div>
      </header>
      <main className="flex-1 w-full min-h-0 flex flex-col">{children}</main>
    </div>
  );
}
