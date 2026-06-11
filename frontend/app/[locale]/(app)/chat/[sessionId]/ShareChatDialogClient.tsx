"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Copy, Globe, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { createChatShareLink, revokeChatShareLink } from "./actions";

interface Props {
  sessionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShareChatDialogClient({ sessionId, open, onOpenChange }: Props) {
  const t = useTranslations("Chat");
  const locale = useLocale();

  const [busy, setBusy] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);

  async function handleCreate() {
    setBusy(true);
    setError(false);
    const result = await createChatShareLink(sessionId);
    setBusy(false);
    if (result.ok) {
      setShareUrl(`${window.location.origin}/${locale}/share/chat/${result.code}`);
    } else {
      setError(true);
    }
  }

  async function handleRevoke() {
    setBusy(true);
    try {
      await revokeChatShareLink(sessionId);
      setShareUrl(null);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable (e.g. non-secure context) — the URL stays selectable
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="h-4 w-4" />
            {t("share_title")}
          </DialogTitle>
          <DialogDescription>{t("share_desc")}</DialogDescription>
        </DialogHeader>

        {/* The disclosure — shown before AND after creating, so it is never skipped */}
        <p className="bg-muted text-muted-foreground rounded-md px-3 py-2 text-xs leading-relaxed">
          {t("share_notice")}
        </p>

        {error && <p className="text-destructive text-xs">{t("share_failed")}</p>}

        {shareUrl ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={shareUrl}
                onFocus={(e) => e.target.select()}
                className="border-border bg-background flex-1 truncate rounded-md border px-2 py-1.5 text-xs"
              />
              <Button size="sm" variant="outline" onClick={handleCopy} className="shrink-0">
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? t("share_copied") : t("share_copy")}
              </Button>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleRevoke}
              disabled={busy}
              className="text-destructive hover:text-destructive self-start"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("share_revoke")}
            </Button>
          </div>
        ) : (
          <Button onClick={handleCreate} disabled={busy} className="w-full">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("share_create")}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
