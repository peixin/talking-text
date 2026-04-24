import Link from "next/link";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-border flex items-center justify-between border-b px-6 py-4">
        <Link href="/" className="font-semibold tracking-wide">
          字有天地
        </Link>
        <nav className="flex gap-5 text-sm">
          <Link href="/chat" className="hover:text-primary">
            对话
          </Link>
          <Link href="/parent" className="hover:text-primary">
            家长
          </Link>
        </nav>
      </header>
      <main className="flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
