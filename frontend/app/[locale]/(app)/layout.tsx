import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { logout } from "./actions";
import LocaleSwitcher from "@/components/LocaleSwitcher";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("Navigation");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-border flex items-center justify-between border-b px-6 py-4">
        <Link href="/" className="font-semibold tracking-wide">
          {t("app_name")}
        </Link>
        <div className="flex items-center gap-5">
          <nav className="flex gap-5 text-sm">
            <Link href="/chat" className="hover:text-primary">
              {t("chat")}
            </Link>
            <Link href="/parent" className="hover:text-primary">
              {t("parent")}
            </Link>
          </nav>
          <form action={logout}>
            <button type="submit" className="text-muted-foreground hover:text-primary mr-4 text-sm transition">
              {t("logout")}
            </button>
          </form>
          <LocaleSwitcher />
        </div>
      </header>
      <main className="flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
