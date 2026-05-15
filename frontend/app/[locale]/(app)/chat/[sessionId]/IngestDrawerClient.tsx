"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  Camera,
  FileText,
  Image as ImageIcon,
  Loader2,
  Mic,
  Paperclip,
  Plus,
  X,
} from "lucide-react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CefrLevel, ExtractedItem, GroupOut, IngestionResult, ItemType } from "@/lib/backend";
import { createGroup, extractIngestion, setSessionGroup } from "./actions";

export type IngestTrigger = "camera" | "voice" | "file";

type Step =
  | { kind: "input" }
  | { kind: "extracting" }
  | { kind: "preview"; mode: "summary" | "edit"; result: IngestionResult }
  | { kind: "saving"; result: IngestionResult }
  | { kind: "error"; message: string };

interface Props {
  sessionId: string;
  open: boolean;
  initialTrigger: IngestTrigger;
  onOpenChange: (open: boolean) => void;
  onGroupApplied: (group: GroupOut) => void;
}

const CEFR_OPTIONS: (CefrLevel | "")[] = ["", "A1", "A2", "B1", "B2", "C1", "C2"];
const ITEM_TYPES: ItemType[] = ["word", "phrase", "pattern"];

function joinBookName(meta: IngestionResult["metadata"]): string {
  const parts = [meta.book_name, meta.unit, meta.lesson]
    .map((s) => s?.trim())
    .filter((s): s is string => !!s);
  return parts.join(" / ");
}

function buildItemsBody(items: ExtractedItem[]) {
  return items
    .filter((i) => i.text.trim().length > 0)
    .map((i) => ({
      text: i.text.trim(),
      type: i.type,
      anchor: i.anchor,
      cefr_level: i.cefr,
      pos: i.pos,
    }));
}

function blankItem(type: ItemType): ExtractedItem {
  return {
    text: "",
    type,
    anchor: null,
    cefr: null,
    pos: null,
    confidence: "high",
    note: null,
  };
}

function sortForEdit(items: ExtractedItem[]): ExtractedItem[] {
  // Low-confidence (often AI noise) bubble up so the user can prune them first.
  const order: Record<string, number> = { low: 0, medium: 1, high: 2 };
  return [...items].sort((a, b) => {
    const ca = order[a.confidence] ?? 1;
    const cb = order[b.confidence] ?? 1;
    if (ca !== cb) return ca - cb;
    return ITEM_TYPES.indexOf(a.type) - ITEM_TYPES.indexOf(b.type);
  });
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

  // Owned by the drawer; refreshed when extraction completes.
  const [items, setItems] = useState<ExtractedItem[]>([]);
  const [groupName, setGroupName] = useState("");

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setStep({ kind: "input" });
      setFiles([]);
      setDescription("");
      setItems([]);
      setGroupName("");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (initialTrigger === "camera") cameraInputRef.current?.click();
    if (initialTrigger === "file") fileInputRef.current?.click();
  }, [open, initialTrigger]);

  const previews = useMemo(
    () => files.map((f) => ({ name: f.name, url: URL.createObjectURL(f) })),
    [files],
  );
  useEffect(() => {
    return () => previews.forEach((p) => URL.revokeObjectURL(p.url));
  }, [previews]);

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
    setItems(sortForEdit(result.result.items));
    setGroupName(joinBookName(result.result.metadata) || t("default_group_name"));
    setStep({ kind: "preview", mode: "summary", result: result.result });
  }

  async function handleSave() {
    if (step.kind !== "preview") return;
    const body = buildItemsBody(items);
    if (body.length === 0) {
      setStep({ kind: "error", message: t("error_no_items") });
      return;
    }
    setStep({ kind: "saving", result: step.result });

    const createRes = await createGroup({
      name: groupName.trim() || t("default_group_name"),
      kind: "quick_practice",
      items: body,
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

  function updateItem(idx: number, patch: Partial<ExtractedItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function deleteItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }
  function addItemOfType(type: ItemType) {
    setItems((prev) => [...prev, blankItem(type)]);
  }

  const sectionedItems = useMemo(() => {
    const acc: Record<ItemType, { item: ExtractedItem; index: number }[]> = {
      word: [],
      phrase: [],
      pattern: [],
    };
    items.forEach((item, index) => {
      acc[item.type].push({ item, index });
    });
    return acc;
  }, [items]);

  const counts = {
    word: sectionedItems.word.length,
    phrase: sectionedItems.phrase.length,
    pattern: sectionedItems.pattern.length,
  };
  const lowConfidenceCount = items.filter((i) => i.confidence === "low").length;

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
                ? t("title_preview", { count: items.length })
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
                {joinBookName(step.result.metadata) && (
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
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    disabled={step.kind === "saving"}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                  />
                </label>

                {step.kind === "preview" && step.mode === "summary" && (
                  <SummaryView
                    counts={counts}
                    lowConfidenceCount={lowConfidenceCount}
                    warnings={step.result.warnings}
                  />
                )}

                {step.kind === "preview" && step.mode === "edit" && (
                  <EditView
                    sectionedItems={sectionedItems}
                    onUpdate={updateItem}
                    onDelete={deleteItem}
                    onAdd={addItemOfType}
                  />
                )}

                {step.kind === "saving" && (
                  <SummaryView
                    counts={counts}
                    lowConfidenceCount={lowConfidenceCount}
                    warnings={step.result.warnings}
                  />
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
            {step.kind === "preview" && step.mode === "summary" && (
              <>
                <Button
                  variant="outline"
                  onClick={() =>
                    setStep({ kind: "preview", mode: "edit", result: step.result })
                  }
                >
                  {t("review")}
                </Button>
                <Button onClick={handleSave}>{t("use_it")}</Button>
              </>
            )}
            {step.kind === "preview" && step.mode === "edit" && (
              <>
                <Button
                  variant="outline"
                  onClick={() =>
                    setStep({ kind: "preview", mode: "summary", result: step.result })
                  }
                >
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


// ── Sub-views ────────────────────────────────────────────────────────────────

function SummaryView({
  counts,
  lowConfidenceCount,
  warnings,
}: {
  counts: { word: number; phrase: number; pattern: number };
  lowConfidenceCount: number;
  warnings: string[];
}) {
  const t = useTranslations("Ingest");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 text-sm">
        <span>
          <span className="font-medium">{counts.word}</span>{" "}
          <span className="text-muted-foreground">{t("section_word")}</span>
        </span>
        <span>
          <span className="font-medium">{counts.phrase}</span>{" "}
          <span className="text-muted-foreground">{t("section_phrase")}</span>
        </span>
        <span>
          <span className="font-medium">{counts.pattern}</span>{" "}
          <span className="text-muted-foreground">{t("section_pattern")}</span>
        </span>
      </div>
      {lowConfidenceCount > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{t("low_confidence_hint", { count: lowConfidenceCount })}</span>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {warnings.join("; ")}
        </div>
      )}
    </div>
  );
}

function EditView({
  sectionedItems,
  onUpdate,
  onDelete,
  onAdd,
}: {
  sectionedItems: Record<ItemType, { item: ExtractedItem; index: number }[]>;
  onUpdate: (idx: number, patch: Partial<ExtractedItem>) => void;
  onDelete: (idx: number) => void;
  onAdd: (type: ItemType) => void;
}) {
  const t = useTranslations("Ingest");
  return (
    <div className="space-y-4">
      {ITEM_TYPES.map((kind) => {
        const list = sectionedItems[kind];
        return (
          <section key={kind}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-medium text-muted-foreground">
                {t(`section_${kind}` as Parameters<typeof t>[0])} ({list.length})
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onAdd(kind)}
                className="h-7 text-xs"
              >
                <Plus className="mr-1 h-3 w-3" />
                {t("add_item")}
              </Button>
            </div>
            {list.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">{t("section_empty")}</p>
            ) : (
              <ul className="space-y-1">
                {list.map(({ item, index }) => (
                  <li
                    key={index}
                    className="flex items-center gap-1 rounded bg-muted/30 px-2 py-1"
                  >
                    {item.confidence === "low" && (
                      <AlertTriangle
                        className="h-3.5 w-3.5 shrink-0 text-amber-600"
                        aria-label={t("low_confidence_item")}
                      />
                    )}
                    <input
                      value={item.text}
                      onChange={(e) => onUpdate(index, { text: e.target.value })}
                      placeholder={t(`placeholder_${kind}` as Parameters<typeof t>[0])}
                      className="flex-1 rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-sm focus:border-border focus:bg-background focus:outline-none"
                    />
                    <select
                      value={item.cefr ?? ""}
                      onChange={(e) =>
                        onUpdate(index, {
                          cefr: (e.target.value || null) as CefrLevel | null,
                        })
                      }
                      className="rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-xs text-muted-foreground hover:border-border focus:border-border focus:bg-background focus:outline-none"
                    >
                      {CEFR_OPTIONS.map((lvl) => (
                        <option key={lvl} value={lvl}>
                          {lvl || "—"}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => onDelete(index)}
                      className="text-muted-foreground/40 hover:text-destructive transition"
                      aria-label={t("delete_item")}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}


// ── Convenience: three-icon toolbar ──────────────────────────────────────────

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
