import Link from "next/link";
import { logout } from "./actions";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-border flex items-center justify-between border-b px-6 py-4">
        <Link href="/" className="font-semibold tracking-wide">
          字有天地
        </Link>
        <div className="flex items-center gap-5">
          <nav className="flex gap-5 text-sm">
            <Link href="/chat" className="hover:text-primary">
              对话
            </Link>
            <Link href="/parent" className="hover:text-primary">
              家长
            </Link>
          </nav>
          <form action={logout}>
            <button type="submit" className="text-muted-foreground hover:text-primary text-sm transition">
              退出登录
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
