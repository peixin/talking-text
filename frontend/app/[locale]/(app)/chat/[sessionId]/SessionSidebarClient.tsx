"use client";

import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/en";
import "dayjs/locale/zh-cn";
import "dayjs/locale/zh-tw";
import { Plus, Trash2, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { LearnerOut, SessionOut } from "@/lib/backend";
import { useRouter } from "@/i18n/routing";
import { setActiveLearner } from "./actions";
import { useState, useEffect } from "react";

dayjs.extend(relativeTime);

interface Props {
  sessions: SessionOut[];
  activeSessionId: string;
  activeLearner: LearnerOut;
  learners: LearnerOut[];
  isOpen: boolean;
  onClose: () => void;
  onNewSession: () => void;
  onDeleteSession: (session: SessionOut) => void;
}

export function SessionSidebarClient({
  sessions,
  activeSessionId,
  activeLearner,
  learners,
  isOpen,
  onClose,
  onNewSession,
  onDeleteSession,
}: Props) {
  const t = useTranslations("Chat");
  const router = useRouter();
  const locale = useLocale();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setMounted(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  async function switchLearner(learnerId: string) {
    await setActiveLearner(learnerId);
    router.push("/chat");
  }

  return (
    <>
      {/* Mobile backdrop — conditional render so it never blocks touch when closed */}
      {isOpen && <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={onClose} />}

      <aside
        className={[
          "border-border bg-background shrink-0 flex-col border-r",
          // Desktop: always visible as static sidebar
          "md:static md:z-auto md:flex md:w-56",
          // Mobile: hidden (display:none) when closed so iOS touch-area bug cannot block events;
          //         fixed overlay when open
          isOpen ? "fixed inset-y-0 left-0 z-50 flex w-72" : "hidden",
        ].join(" ")}
      >
        {/* Mobile close button */}
        <div className="border-border flex items-center justify-end border-b px-3 py-2 md:hidden">
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {learners.length > 1 && (
          <div className="border-border border-b px-3 py-2">
            <select
              value={activeLearner.id}
              onChange={(e) => switchLearner(e.target.value)}
              className="border-border bg-background w-full rounded border px-2 py-1 text-sm focus:outline-none"
            >
              {learners.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="px-3 py-2">
          <button
            onClick={onNewSession}
            className="text-muted-foreground hover:bg-muted hover:text-foreground flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition"
          >
            <Plus className="h-4 w-4" />
            {t("new_session")}
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto">
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                router.push(`/chat/${s.id}`);
                onClose();
              }}
              className={`group hover:bg-muted relative flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm transition ${
                s.id === activeSessionId ? "bg-muted font-medium" : "text-muted-foreground"
              }`}
            >
              <span className="w-full truncate pr-6">
                {s.title ? (
                  s.title
                ) : (
                  <span className="bg-muted-foreground/20 inline-block h-3.5 w-3/4 animate-pulse rounded" />
                )}
              </span>
              <span className="text-muted-foreground/60 text-xs">
                {mounted
                  ? dayjs(s.updated_at).locale(locale.toLowerCase()).fromNow()
                  : dayjs(s.updated_at).format("YYYY-MM-DD")}
              </span>

              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteSession(s);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.stopPropagation();
                    onDeleteSession(s);
                  }
                }}
                className="text-muted-foreground/40 hover:text-destructive absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 opacity-0 transition group-hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </span>
            </button>
          ))}
        </nav>
      </aside>
    </>
  );
}
