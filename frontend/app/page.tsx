import Link from "next/link";

import { backend } from "@/lib/backend";

export const dynamic = "force-dynamic";

type Phrase = { zh: string; en: string };

const PHRASES: Phrase[] = [
  { zh: "开口，便是一个世界。", en: "Words become your world." },
  { zh: "开口一次，世界就大一寸。", en: "One word, one world." },
  { zh: "说得出，才算你的。", en: "If you can say it, it's yours." },
  { zh: "用你懂的，说出你的世界。", en: "Your voice creates your world." },
];

function pickPhrase(): Phrase {
  return PHRASES[Math.floor(Math.random() * PHRASES.length)];
}

async function getHealth(): Promise<"ok" | "offline"> {
  try {
    const h = await backend.health();
    return h.status === "ok" ? "ok" : "offline";
  } catch {
    return "offline";
  }
}

export default async function HomePage() {
  const phrase = pickPhrase();
  const health = await getHealth();

  return (
    <div className="flex min-h-screen flex-col px-6 py-8">
      <main className="mx-auto flex max-w-2xl flex-1 flex-col items-center justify-center gap-10 text-center">
        <div className="flex flex-col items-center gap-1">
          <h1 className="text-5xl font-semibold tracking-wider sm:text-6xl">字有天地</h1>
          <p className="text-muted-foreground text-xs tracking-[0.3em] uppercase">Talking Text</p>
        </div>

        <p className="text-primary text-2xl font-medium tracking-widest">言出成界</p>

        <div className="border-border flex w-full max-w-sm flex-col gap-1 border-y py-6">
          <p className="text-xl">{phrase.zh}</p>
          <p className="text-muted-foreground text-base italic">{phrase.en}</p>
        </div>

        <div className="flex flex-wrap justify-center gap-3">
          <Link
            href="/login"
            className="bg-primary text-primary-foreground inline-flex items-center justify-center rounded-lg px-6 py-2.5 text-sm font-medium transition hover:opacity-85"
          >
            登录
          </Link>
          <Link
            href="/register"
            className="border-primary text-primary hover:bg-primary/5 inline-flex items-center justify-center rounded-lg border px-6 py-2.5 text-sm font-medium transition"
          >
            注册
          </Link>
        </div>
      </main>

      <footer className="text-muted-foreground flex items-center justify-center gap-2 pt-8 text-xs">
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${
            health === "ok" ? "bg-green-600" : "bg-red-500"
          }`}
        />
        <span>backend: {health}</span>
      </footer>
    </div>
  );
}
