"use client";

import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { LearnerOut, SessionOut } from "@/lib/backend";
import { setActiveLearner } from "./actions";
import { useRouter } from "@/i18n/routing";

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小时前`;
  return `${Math.floor(hrs / 24)} 天前`;
}

interface Props {
  sessions: SessionOut[];
  activeSessionId: string;
  activeLearner: LearnerOut;
  learners: LearnerOut[];
  onNewSession: () => void;
  onDeleteSession: (session: SessionOut) => void;
}

export function SessionSidebarClient({
  sessions,
  activeSessionId,
  activeLearner,
  learners,
  onNewSession,
  onDeleteSession,
}: Props) {
  const t = useTranslations("Chat");
  const router = useRouter();

  async function switchLearner(learnerId: string) {
    await setActiveLearner(learnerId);
    router.push("/chat");
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border">
      {learners.length > 1 && (
        <div className="border-b border-border px-3 py-2">
          <select
            value={activeLearner.id}
            onChange={(e) => switchLearner(e.target.value)}
            className="w-full rounded border border-border bg-background px-2 py-1 text-sm focus:outline-none"
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
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
          {t("new_session")}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto">
        {sessions.map((s) => (
          <button
            key={s.id}
            onClick={() => router.push(`/chat/${s.id}`)}
            className={`group relative flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm transition hover:bg-muted ${
              s.id === activeSessionId ? "bg-muted font-medium" : "text-muted-foreground"
            }`}
          >
            <span className="w-full truncate pr-6">
              {s.title ? (
                s.title
              ) : (
                <span className="inline-block h-3.5 w-3/4 animate-pulse rounded bg-muted-foreground/20" />
              )}
            </span>
            <span className="text-xs text-muted-foreground/60">{relativeTime(s.updated_at)}</span>

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
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground/40 opacity-0 transition hover:text-destructive group-hover:opacity-100"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
