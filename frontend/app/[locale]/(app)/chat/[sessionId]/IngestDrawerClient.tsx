"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Camera, FileText, Image as ImageIcon, Loader2, Mic, Paperclip, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ExtractedItem, GroupOut, IngestionResult } from "@/lib/backend";
import { createGroup, extractIngestion, setSessionGroup } from "./actions";

export type IngestTrigger = "camera" | "voice" | "file";

type Step =
  | { kind: "input" }
  | { kind: "extracting" }
  | { kind: "preview"; result: IngestionResult; name: string }
  | { kind: "saving"; result: IngestionResult; name: string }
  | { kind: "error"; message: string };

interface Props {
  sessionId: string;
  open: boolean;
  initialTrigger: IngestTrigger;
  onOpenChange: (open: boolean) => void;
  onGroupApplied: (group: GroupOut) => void;
}

function joinBookName(meta: IngestionResult["metadata"]): string {
  const parts = [meta.book_name, meta.unit, meta.lesson]
    .map((s) => s?.trim())
    .filter((s): s is string => !!s);
  return parts.length > 0 ? parts.join(" / ") : "";
}

function buildItemsBody(items: ExtractedItem[]) {
  return items.map((i) => ({
    text: i.text,
    type: i.type,
    anchor: i.anchor,
    cefr_level: i.cefr,
    pos: i.pos,
  }));
}

export function IngestDrawerClient({
  sessionId,
  open,
  initialTrigger,
  onOpenChange,
  onGroupApplied,
}: Props) {
  const t = useTranslations("Ingest");
  const [step, setStep] = useState<Step>({ kind: "input" });
  const [files, setFiles] = useState<File[]>([]);
  const [description, setDescription] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  // Reset state when the drawer opens or closes
  useEffect(() => {
    if (open) {
      setStep({ kind: "input" });
      setFiles([]);
      setDescription("");
    }
  }, [open]);

  // Auto-open the right picker for the trigger that was tapped
  useEffect(() => {
    if (!open) return;
    if (initialTrigger === "camera") cameraInputRef.current?.click();
    if (initialTrigger === "file") fileInputRef.current?.click();
    // "voice" is a placeholder until V1.1 — drawer just opens to the input step.
  }, [open, initialTrigger]);

  const previews = files.map((f) => ({ name: f.name, url: URL.createObjectURL(f) }));
  // Revoke object URLs when files change to avoid leaks
  useEffect(() => {
    return () => previews.forEach((p) => URL.revokeObjectURL(p.url));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  function addFiles(selected: FileList | null) {
    if (!selected || selected.length === 0) return;
    const next = [...files];
    for (const f of Array.from(selected)) {
      if (next.length >= 5) break;
      next.push(f);
    }
    setFiles(next);
  }

  async function handleExtract() {
    if (files.length === 0 && !description.trim()) {
      setStep({ kind: "error", message: t("error_no_input") });
      return;
    }
    setStep({ kind: "extracting" });
    const fd = new FormData();
    if (description.trim()) fd.append("description", description.trim());
    for (const f of files) fd.append("images", f, f.name);

    const result = await extractIngestion(fd);
    if (!result.ok) {
      setStep({ kind: "error", message: result.error || t("error_extract_failed") });
      return;
    }
    if (result.result.items.length === 0) {
      setStep({ kind: "error", message: t("error_no_items") });
      return;
    }
    const suggested = joinBookName(result.result.metadata) || t("default_group_name");
    setStep({ kind: "preview", result: result.result, name: suggested });
  }

  async function handleSave() {
    if (step.kind !== "preview") return;
    setStep({ kind: "saving", result: step.result, name: step.name });

    const createRes = await createGroup({
      name: step.name.trim() || t("default_group_name"),
      kind: "quick_practice",
      items: buildItemsBody(step.result.items),
      source_book_hint: step.result.metadata.book_name ?? null,
    });
    if (!createRes.ok) {
      setStep({ kind: "error", message: createRes.error || t("error_save_failed") });
      return;
    }
    try {
      await setSessionGroup(sessionId, createRes.group.id);
    } catch {
      setStep({ kind: "error", message: t("error_scope_failed") });
      return;
    }
    onGroupApplied(createRes.group);
    onOpenChange(false);
  }

  const itemsByType = (() => {
    if (step.kind !== "preview" && step.kind !== "saving") {
      return { word: [], phrase: [], pattern: [] };
    }
    const groups: Record<string, ExtractedItem[]> = { word: [], phrase: [], pattern: [] };
    for (const item of step.result.items) groups[item.type]?.push(item);
    return groups;
  })();

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          className={cn(
            "fixed inset-0 z-50 bg-black/30 duration-150",
            "data-open:animate-in data-open:fade-in-0",
            "data-closed:animate-out data-closed:fade-out-0",
          )}
        />
        <DialogPrimitive.Popup
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[80vh] w-full max-w-2xl flex-col",
            "rounded-t-2xl border-t bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/10",
            "duration-200 outline-none",
            "data-open:animate-in data-open:slide-in-from-bottom",
            "data-closed:animate-out data-closed:slide-out-to-bottom",
            "sm:bottom-4 sm:rounded-2xl sm:border",
          )}
        >
          <header className="flex shrink-0 items-center justify-between border-b px-4 py-3">
            <DialogPrimitive.Title className="text-sm font-medium">
              {step.kind === "preview" || step.kind === "saving"
                ? t("title_preview", { count: step.result.items.length })
                : t("title_input")}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              render={
                <Button variant="ghost" size="icon-sm" aria-label={t("close")}>
                  <X className="h-4 w-4" />
                </Button>
              }
            />
          </header>

          <div className="flex-1 overflow-y-auto px-4 py-4">
            {step.kind === "input" && (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => cameraInputRef.current?.click()}
                  >
                    <Camera className="mr-2 h-4 w-4" />
                    {t("take_photo")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <ImageIcon className="mr-2 h-4 w-4" />
                    {t("upload_images")}
                  </Button>
                </div>
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  className="hidden"
                  onChange={(e) => addFiles(e.target.files)}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => addFiles(e.target.files)}
                />

                {previews.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {previews.map((p, i) => (
                      <div
                        key={p.url}
                        className="group relative h-20 w-20 overflow-hidden rounded-md border bg-muted"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.url} alt={p.name} className="h-full w-full object-cover" />
                        <button
                          type="button"
                          onClick={() => setFiles(files.filter((_, idx) => idx !== i))}
                          className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white opacity-0 transition group-hover:opacity-100"
                          aria-label={t("remove_image")}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <label className="block">
                  <span className="mb-1 block text-xs text-muted-foreground">
                    {t("description_label")}
                  </span>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t("description_placeholder")}
                    rows={2}
                    className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </label>
              </div>
            )}

            {step.kind === "extracting" && (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
                {t("extracting")}
              </div>
            )}

            {(step.kind === "preview" || step.kind === "saving") && (
              <div className="space-y-4">
                {step.result.metadata.book_name && (
                  <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                    <div className="text-muted-foreground text-xs">{t("looks_like")}</div>
                    <div className="font-medium">{joinBookName(step.result.metadata)}</div>
                  </div>
                )}

                <label className="block">
                  <span className="mb-1 block text-xs text-muted-foreground">
                    {t("group_name_label")}
                  </span>
                  <input
                    value={step.name}
                    onChange={(e) =>
                      setStep((s) =>
                        s.kind === "preview" ? { ...s, name: e.target.value } : s,
                      )
                    }
                    disabled={step.kind === "saving"}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                  />
                </label>

                {(["word", "phrase", "pattern"] as const).map((kind) => {
                  const list = itemsByType[kind];
                  if (!list || list.length === 0) return null;
                  return (
                    <section key={kind}>
                      <h3 className="mb-1 text-xs font-medium text-muted-foreground">
                        {t(`section_${kind}` as Parameters<typeof t>[0])}{" "}
                        ({list.length})
                      </h3>
                      <ul className="space-y-1">
                        {list.map((item, i) => (
                          <li
                            key={`${kind}-${i}`}
                            className="flex items-center justify-between rounded bg-muted/30 px-2 py-1 text-sm"
                          >
                            <span>{item.text}</span>
                            <span className="ml-2 text-xs text-muted-foreground">
                              {item.cefr ?? ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })}

                {step.result.warnings.length > 0 && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                    {step.result.warnings.join("; ")}
                  </div>
                )}
              </div>
            )}

            {step.kind === "error" && (
              <div className="flex flex-col items-center gap-3 py-8 text-center text-sm">
                <p className="text-destructive">{step.message}</p>
                <Button variant="outline" onClick={() => setStep({ kind: "input" })}>
                  {t("try_again")}
                </Button>
              </div>
            )}
          </div>

          <footer className="flex shrink-0 items-center justify-end gap-2 border-t bg-muted/30 px-4 py-3">
            {step.kind === "input" && (
              <Button
                onClick={handleExtract}
                disabled={files.length === 0 && !description.trim()}
              >
                {t("extract")}
              </Button>
            )}
            {step.kind === "extracting" && (
              <Button disabled>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("extracting")}
              </Button>
            )}
            {step.kind === "preview" && (
              <>
                <Button variant="outline" onClick={() => setStep({ kind: "input" })}>
                  {t("back")}
                </Button>
                <Button onClick={handleSave}>{t("save_and_use")}</Button>
              </>
            )}
            {step.kind === "saving" && (
              <Button disabled>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("saving")}
              </Button>
            )}
          </footer>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// Convenience component for the three-icon toolbar
export function IngestToolbarClient({
  onOpen,
}: {
  onOpen: (trigger: IngestTrigger) => void;
}) {
  const t = useTranslations("Ingest");
  return (
    <div className="flex shrink-0 items-center gap-1 px-2">
      <button
        type="button"
        onClick={() => onOpen("camera")}
        className="text-muted-foreground hover:text-foreground transition flex h-9 w-9 items-center justify-center rounded-full"
        aria-label={t("trigger_camera")}
      >
        <Camera className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => onOpen("voice")}
        className="text-muted-foreground/40 transition flex h-9 w-9 items-center justify-center rounded-full"
        aria-label={t("trigger_voice")}
        disabled
        title={t("trigger_voice_coming_soon")}
      >
        <Mic className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => onOpen("file")}
        className="text-muted-foreground hover:text-foreground transition flex h-9 w-9 items-center justify-center rounded-full"
        aria-label={t("trigger_file")}
      >
        <Paperclip className="h-4 w-4" />
      </button>
      <FileText className="hidden" />
    </div>
  );
}
