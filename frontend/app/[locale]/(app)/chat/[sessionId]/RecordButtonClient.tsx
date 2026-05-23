"use client";

import { Loader2, Mic, Square } from "lucide-react";
import { useTranslations } from "next-intl";

export type Mode = "idle" | "recording" | "uploading";

interface Props {
  mode: Mode;
  error: string | null;
  onRecordToggle: () => void;
}

export function RecordButtonClient({ mode, error, onRecordToggle }: Props) {
  const t = useTranslations("Chat");
  const tErr = useTranslations("Chat.errors");

  return (
    <div className="border-border bg-background flex flex-col items-center gap-2 border-t px-4 py-4">
      {error && <p className="text-destructive text-center text-sm">{tErr(error)}</p>}
      <button
        type="button"
        onClick={onRecordToggle}
        disabled={mode === "uploading"}
        className={`flex h-16 w-16 items-center justify-center rounded-full transition active:scale-95 ${
          mode === "recording"
            ? "bg-destructive text-destructive-foreground animate-pulse"
            : mode === "uploading"
              ? "bg-muted text-muted-foreground cursor-not-allowed"
              : "bg-primary text-primary-foreground hover:opacity-90"
        }`}
        aria-label={mode === "recording" ? t("stop") : t("press_to_talk")}
      >
        {mode === "recording" ? (
          <Square className="pointer-events-none h-6 w-6" />
        ) : mode === "uploading" ? (
          <Loader2 className="pointer-events-none h-6 w-6 animate-spin" />
        ) : (
          <Mic className="pointer-events-none h-6 w-6" />
        )}
      </button>
      <span className="text-muted-foreground text-xs">
        {mode === "recording"
          ? t("recording_hint")
          : mode === "uploading"
            ? t("uploading_hint")
            : t("press_to_talk")}
      </span>
    </div>
  );
}
