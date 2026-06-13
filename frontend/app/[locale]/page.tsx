import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { backend } from "@/lib/backend";
import { buttonVariants } from "@/components/ui/button";
import LocaleSwitcher from "@/components/LocaleSwitcher";

export const dynamic = "force-dynamic";

async function getHealth(): Promise<"ok" | "offline"> {
  try {
    const h = await backend.health();
    return h.status === "ok" ? "ok" : "offline";
  } catch {
    return "offline";
  }
}

export default async function HomePage() {
  const tHome = await getTranslations("Home");
  const health = await getHealth();

  return (
    <div className="relative flex min-h-screen flex-col px-6 py-8">
      <div className="absolute top-8 right-8">
        <LocaleSwitcher />
      </div>
      <main className="mx-auto flex max-w-2xl flex-1 flex-col items-center justify-center gap-10 text-center">
        <div className="flex flex-col items-center gap-1">
          <h1 className="text-5xl font-semibold tracking-wider sm:text-6xl">
            {tHome("brand_title")}
          </h1>
          <p className="text-muted-foreground text-xs tracking-[0.3em] uppercase">Talking Text</p>
        </div>

        <p className="text-primary text-2xl font-medium tracking-widest">
          {tHome("brand_tagline")}
        </p>

        <div className="flex flex-wrap justify-center gap-3">
          <Link href="/login" className={buttonVariants({ size: "lg" })}>
            {tHome("login")}
          </Link>
          <Link href="/register" className={buttonVariants({ variant: "outline", size: "lg" })}>
            {tHome("register")}
          </Link>
        </div>
      </main>

      <footer className="text-muted-foreground flex items-center justify-center gap-2 pt-8 text-xs">
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${
            health === "ok" ? "bg-success" : "bg-destructive"
          }`}
        />
        <span>backend: {health}</span>
      </footer>
    </div>
  );
}
