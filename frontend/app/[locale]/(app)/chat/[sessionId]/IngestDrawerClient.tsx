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

import { Alert, AlertAction, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  INGEST_IMAGE_MAX_MB,
  INGEST_MAX_IMAGES,
  INGEST_RECORDING_MAX_SECONDS,
  INGEST_TEXT_MAX_CHARS,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { CefrLevel, ExtractedItem, GroupOut, IngestionResult, ItemType } from "@/lib/backend";
import { createGroup, extractIngestion, setSessionGroup, transcribeIngestion } from "./actions";

export type IngestTrigger = "camera" | "voice" | "file";

type Step =
  | { kind: "input" }
  | { kind: "extracting" }
  | { kind: "preview"; mode: "summary" | "edit"; result: IngestionResult }
  | { kind: "saving"; result: IngestionResult }
  | { kind: "error"; message: string };

interface Props {
  sessionId?: string;
  open: boolean;
  initialTrigger?: IngestTrigger | null;
  onOpenChange: (open: boolean) => void;
  onGroupApplied: (group: GroupOut) => void;
}

const CEFR_OPTIONS: (CefrLevel | "")[] = ["", "A1", "A2", "B1", "B2", "C1", "C2"];
const ITEM_TYPES: ItemType[] = ["word", "phrase", "pattern"];

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
  const [rawText, setRawText] = useState("");

  // Owned by the drawer; refreshed when extraction completes.
  const [items, setItems] = useState<ExtractedItem[]>([]);
  // Capture is a flat bag: just a name, no hierarchy. Structuring happens later
  // in the organize workbench. See docs/content-lifecycle.md §3, §4.
  const [name, setName] = useState<string>("");
  const [inferredCefr, setInferredCefr] = useState<string | null>(null);
  // The parent's own note about this material, separated out by the AI. Editable,
  // saved as the group's prompt_notes — never mixed into the extracted items.
  const [parentNote, setParentNote] = useState<string>("");

  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const warningTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Voice ingestion (independent of the chat record button).
  const [recordMode, setRecordMode] = useState<"idle" | "recording" | "transcribing">("idle");
  const [recordError, setRecordError] = useState<string | null>(null);
  const [recordRemaining, setRecordRemaining] = useState<number | null>(null);
  const recorderTickerRef = useRef<NodeJS.Timeout | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunksRef = useRef<BlobPart[]>([]);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const recorderMimeRef = useRef<string>("");
  const recorderTimerRef = useRef<NodeJS.Timeout | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (open) {
      timer = setTimeout(() => {
        setStep({ kind: "input" });
        setFiles([]);
        setDescription("");
        setItems([]);
        setName("");
        setRawText("");
        setInferredCefr(null);
        setParentNote("");
        setRecordMode("idle");
        setRecordError(null);
        setWarningMessage(null);
        setPreviewImageUrl(null);
        if (warningTimeoutRef.current) {
          clearTimeout(warningTimeoutRef.current);
          warningTimeoutRef.current = null;
        }
      }, 0);
    } else {
      stopRecorderStream();
    }
    return () => {
      if (timer) clearTimeout(timer);
      if (warningTimeoutRef.current) {
        clearTimeout(warningTimeoutRef.current);
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open || !initialTrigger) return;
    if (initialTrigger === "camera") cameraInputRef.current?.click();
    if (initialTrigger === "file") fileInputRef.current?.click();
    if (initialTrigger === "voice") void startRecording();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialTrigger]);

  function pickRecorderMime(): string {
    if (typeof MediaRecorder === "undefined") return "";
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4",
    ];
    for (const m of candidates) if (MediaRecorder.isTypeSupported(m)) return m;
    return "";
  }

  function stopRecorderStream() {
    if (recorderTimerRef.current) {
      clearTimeout(recorderTimerRef.current);
      recorderTimerRef.current = null;
    }
    if (recorderTickerRef.current) {
      clearInterval(recorderTickerRef.current);
      recorderTickerRef.current = null;
    }
    setRecordRemaining(null);
    recorderStreamRef.current?.getTracks().forEach((tr) => tr.stop());
    recorderStreamRef.current = null;
    recorderRef.current = null;
  }

  async function startRecording() {
    setRecordError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 48000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      recorderStreamRef.current = stream;
      const mime = pickRecorderMime();
      recorderMimeRef.current = mime;
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorderChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) recorderChunksRef.current.push(ev.data);
      };
      recorder.onstop = () => void finishRecording();
      recorder.start();
      setRecordMode("recording");
      // Auto-stop so a forgotten open mic doesn't record indefinitely.
      recorderTimerRef.current = setTimeout(stopRecording, INGEST_RECORDING_MAX_SECONDS * 1000);
      const startedAt = Date.now();
      setRecordRemaining(INGEST_RECORDING_MAX_SECONDS);
      recorderTickerRef.current = setInterval(() => {
        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        setRecordRemaining(Math.max(0, INGEST_RECORDING_MAX_SECONDS - elapsed));
      }, 1000);
    } catch {
      setRecordError(t("error_mic_denied"));
      setRecordMode("idle");
    }
  }

  function stopRecording() {
    if (recorderTimerRef.current) {
      clearTimeout(recorderTimerRef.current);
      recorderTimerRef.current = null;
    }
    if (recorderTickerRef.current) {
      clearInterval(recorderTickerRef.current);
      recorderTickerRef.current = null;
    }
    setRecordRemaining(null);
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
      setRecordMode("transcribing");
    }
  }

  async function finishRecording() {
    const blob = new Blob(recorderChunksRef.current, {
      type: recorderMimeRef.current || "audio/webm",
    });
    stopRecorderStream();
    if (blob.size === 0) {
      setRecordError(t("error_audio_empty"));
      setRecordMode("idle");
      return;
    }
    const fd = new FormData();
    const ext = (recorderMimeRef.current || "audio/webm").includes("mp4") ? "mp4" : "webm";
    fd.append("audio", blob, `voice.${ext}`);
    const result = await transcribeIngestion(fd);
    if (!result.ok) {
      setRecordError(result.error || t("error_transcribe_failed"));
      setRecordMode("idle");
      return;
    }
    setDescription((prev) => {
      const trimmed = prev.trim();
      return trimmed ? `${trimmed} ${result.text}` : result.text;
    });
    setRecordMode("idle");
  }

  function handleRecordToggle() {
    if (recordMode === "recording") stopRecording();
    else if (recordMode === "idle") void startRecording();
  }

  const previews = useMemo(
    () => files.map((f) => ({ name: f.name, url: URL.createObjectURL(f) })),
    [files],
  );
  useEffect(() => {
    return () => previews.forEach((p) => URL.revokeObjectURL(p.url));
  }, [previews]);

  const triggerWarning = (msg: string) => {
    setWarningMessage(msg);
    if (warningTimeoutRef.current) {
      clearTimeout(warningTimeoutRef.current);
    }
    warningTimeoutRef.current = setTimeout(() => {
      setWarningMessage(null);
    }, 5000);
  };

  function addFiles(selected: FileList | File[] | null) {
    if (!selected) return;
    const arr = Array.from(selected);
    if (arr.length === 0) return;

    let limitWarning = false;
    let sizeWarning = false;
    const next = [...files];
    let currentTotalSize = next.reduce((sum, file) => sum + file.size, 0);

    const maxBytes = INGEST_IMAGE_MAX_MB * 1024 * 1024;
    for (const f of arr) {
      if (next.length >= INGEST_MAX_IMAGES) {
        limitWarning = true;
        break;
      }
      if (f.size > maxBytes) {
        sizeWarning = true;
        continue;
      }
      if (currentTotalSize + f.size > maxBytes) {
        sizeWarning = true;
        continue;
      }
      next.push(f);
      currentTotalSize += f.size;
    }
    setFiles(next);

    if (limitWarning) {
      triggerWarning(t("warning_limit_reached", { max: INGEST_MAX_IMAGES }));
    } else if (sizeWarning) {
      triggerWarning(t("warning_size_reached", { max: INGEST_IMAGE_MAX_MB }));
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const pastedFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.indexOf("image") !== -1) {
        const file = item.getAsFile();
        if (file) {
          const extension = file.type.split("/")[1] || "png";
          const fileName =
            file.name === "image.png" ? `paste-${Date.now()}.${extension}` : file.name;
          const customFile = new File([file], fileName, { type: file.type });
          pastedFiles.push(customFile);
        }
      }
    }

    if (pastedFiles.length > 0) {
      e.preventDefault();
      addFiles(pastedFiles);
    }
  };

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
    const meta = result.result.metadata;
    setName((meta.suggested_name || "").trim());
    setInferredCefr(meta.cefr_level || "");
    setParentNote((meta.parent_note || "").trim());
    setItems(sortForEdit(result.result.items));
    setRawText(result.result.source_raw_text || "");
    setStep({ kind: "preview", mode: "summary", result: result.result });
  }

  async function handleReExtract() {
    if (!rawText.trim()) return;
    setStep({ kind: "extracting" });
    const fd = new FormData();
    fd.append("description", rawText.trim());

    const result = await extractIngestion(fd);
    if (!result.ok) {
      setStep({ kind: "error", message: result.error || t("error_extract_failed") });
      return;
    }
    if (result.result.items.length === 0) {
      setStep({ kind: "error", message: t("error_no_items") });
      return;
    }
    const meta = result.result.metadata;
    setName((meta.suggested_name || "").trim());
    setInferredCefr(meta.cefr_level || "");
    setParentNote((meta.parent_note || "").trim());
    setItems(sortForEdit(result.result.items));
    setRawText(result.result.source_raw_text || "");
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
      name: name.trim() || t("default_group_name"),
      kind: "quick_practice",
      items: body,
      prompt_notes: parentNote.trim() || null,
      source_raw_text: rawText.trim() || null,
    });
    if (!createRes.ok) {
      setStep({ kind: "error", message: createRes.error || t("error_save_failed") });
      return;
    }
    if (sessionId) {
      try {
        await setSessionGroup(sessionId, createRes.group.id);
      } catch {
        setStep({ kind: "error", message: t("error_scope_failed") });
        return;
      }
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
            "bg-popover text-popover-foreground ring-foreground/10 rounded-t-2xl border-t shadow-lg ring-1",
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
              <div className="space-y-4" onPaste={handlePaste}>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={files.length >= INGEST_MAX_IMAGES}
                    onClick={() => cameraInputRef.current?.click()}
                  >
                    <Camera className="mr-2 h-4 w-4" />
                    {t("take_photo")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={files.length >= INGEST_MAX_IMAGES}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <ImageIcon className="mr-2 h-4 w-4" />
                    {t("upload_images")}
                  </Button>
                  {files.length > 0 && (
                    <Badge
                      variant={files.length >= INGEST_MAX_IMAGES ? "warning" : "outline"}
                      className={cn(
                        "rounded-full text-[10px] tabular-nums",
                        files.length >= INGEST_MAX_IMAGES
                          ? "border-warning/40 bg-warning/10"
                          : "text-muted-foreground font-normal",
                      )}
                    >
                      {t("image_count", { count: files.length, max: INGEST_MAX_IMAGES })}
                    </Badge>
                  )}
                  <Button
                    variant={recordMode === "recording" ? "destructive" : "outline"}
                    size="sm"
                    onClick={handleRecordToggle}
                    disabled={recordMode === "transcribing"}
                  >
                    {recordMode === "recording" ? (
                      <>
                        <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-current" />
                        {t("stop_recording")}
                        {recordRemaining != null && recordRemaining <= 10 && (
                          <span className="ml-1 tabular-nums">({recordRemaining}s)</span>
                        )}
                      </>
                    ) : recordMode === "transcribing" ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {t("transcribing")}
                      </>
                    ) : (
                      <>
                        <Mic className="mr-2 h-4 w-4" />
                        {t("record_voice")}
                      </>
                    )}
                  </Button>
                </div>
                {recordError && <p className="text-destructive text-xs">{recordError}</p>}

                {warningMessage && (
                  <Alert
                    variant="warning"
                    className="animate-in fade-in slide-in-from-top-1 px-3 py-2 text-xs shadow-sm duration-200 has-data-[slot=alert-action]:pr-8"
                  >
                    <AlertTriangle className="size-4" />
                    <AlertTitle>{warningMessage}</AlertTitle>
                    <AlertAction>
                      <button
                        type="button"
                        onClick={() => setWarningMessage(null)}
                        className="text-warning/60 hover:text-warning"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </AlertAction>
                  </Alert>
                )}
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
                        className="group bg-muted relative h-20 w-20 overflow-hidden rounded-md border"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={p.url}
                          alt={p.name}
                          onClick={() => setPreviewImageUrl(p.url)}
                          className="h-full w-full cursor-zoom-in object-cover transition-transform duration-200 hover:scale-105"
                        />
                        <button
                          type="button"
                          onClick={() => setFiles(files.filter((_, idx) => idx !== i))}
                          className="animate-in fade-in absolute top-1 right-1 rounded-full bg-black/60 p-0.5 text-white opacity-0 transition duration-150 group-hover:opacity-100"
                          aria-label={t("remove_image")}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <label className="block">
                  <span className="text-muted-foreground mb-1 block text-xs">
                    {t("description_label")}
                  </span>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t("description_placeholder")}
                    maxLength={INGEST_TEXT_MAX_CHARS}
                    rows={2}
                    className="border-border bg-background focus:ring-ring w-full resize-none rounded-md border px-3 py-2 text-sm focus:ring-1 focus:outline-none"
                  />
                  {/* Char counter — surfaces only when the limit is getting close */}
                  {description.length >= INGEST_TEXT_MAX_CHARS * 0.8 && (
                    <span className="text-muted-foreground block text-right text-[10px] tabular-nums">
                      {description.length}/{INGEST_TEXT_MAX_CHARS}
                    </span>
                  )}
                </label>
              </div>
            )}

            {step.kind === "extracting" && (
              <div className="text-muted-foreground flex flex-col items-center justify-center gap-2 py-12 text-sm">
                <Loader2 className="h-6 w-6 animate-spin" />
                {t("extracting")}
              </div>
            )}

            {(step.kind === "preview" || step.kind === "saving") && (
              <div className="space-y-4">
                {/* Capture name — a flat bag. Organizing into a textbook tree is a
                    separate step in the organize workbench. */}
                <div className="border-primary/10 bg-primary/5 space-y-2 rounded-xl border p-4">
                  <label className="text-primary block text-[10px] font-bold tracking-wider uppercase">
                    {t("capture_name_label")}
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={step.kind === "saving"}
                    placeholder={t("capture_name_placeholder")}
                    className="bg-background border-border focus:ring-ring w-full rounded-lg border px-3 py-1.5 text-sm font-medium outline-none focus:ring-1 disabled:opacity-50"
                  />
                </div>

                {/* CEFR Level Selection */}
                <div className="space-y-1">
                  <label className="text-primary block text-[10px] font-bold tracking-wider uppercase">
                    {t("cefr_label")}
                  </label>
                  <select
                    value={inferredCefr || ""}
                    onChange={(e) => setInferredCefr(e.target.value || null)}
                    disabled={step.kind === "saving"}
                    className="border-border bg-background focus:ring-ring w-full rounded-lg border px-3 py-1.5 text-sm outline-none focus:ring-1 disabled:opacity-50"
                  >
                    <option value="">{t("cefr_auto_option")}</option>
                    {CEFR_OPTIONS.filter(Boolean).map((lvl) => (
                      <option key={lvl} value={lvl}>
                        {t("cefr_option_label", { level: lvl })}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Parent note — separated from the content by the AI. Saved as the
                    group's prompt_notes; it steers the AI teacher, never becomes items. */}
                <div className="border-success/15 bg-success/5 space-y-1.5 rounded-xl border p-4">
                  <label className="text-success flex items-center gap-1.5 text-[10px] font-bold tracking-wider uppercase">
                    {t("parent_note_label")}
                    <span className="bg-success/10 text-success rounded px-1.5 py-px text-[8px] font-bold tracking-normal normal-case">
                      {t("parent_note_badge")}
                    </span>
                  </label>
                  <textarea
                    value={parentNote}
                    onChange={(e) => setParentNote(e.target.value)}
                    disabled={step.kind === "saving"}
                    placeholder={t("parent_note_placeholder")}
                    rows={2}
                    className="bg-background border-border focus:ring-ring w-full resize-y rounded-lg border px-3 py-1.5 text-sm outline-none focus:ring-1 disabled:opacity-50"
                  />
                </div>

                {/* OCR draft & refine (start with vision, refine with text) */}
                {step.kind === "preview" && (
                  <details className="group border-border/60 bg-muted/30 open:border-border open:bg-muted/50 rounded-xl border p-4 transition-all duration-200">
                    <summary className="text-foreground/80 flex cursor-pointer items-center justify-between text-[10px] font-bold tracking-wider uppercase outline-none select-none">
                      <span className="flex items-center gap-1.5">
                        <FileText className="h-3.5 w-3.5" />
                        {t("raw_text_title")}
                      </span>
                      <span className="text-muted-foreground text-[9px] font-normal group-open:hidden">
                        {t("raw_text_expand_hint")}
                      </span>
                    </summary>
                    <div className="mt-3 space-y-3">
                      <textarea
                        value={rawText}
                        onChange={(e) => setRawText(e.target.value)}
                        placeholder={t("raw_text_placeholder")}
                        maxLength={INGEST_TEXT_MAX_CHARS}
                        rows={6}
                        className="bg-background border-border focus:ring-ring w-full resize-y rounded-lg border p-3 font-mono text-xs leading-relaxed outline-none focus:ring-1"
                      />
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={!rawText.trim()}
                          onClick={handleReExtract}
                          className="border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 h-8 gap-1.5 border text-xs font-medium transition-all active:scale-[0.98]"
                        >
                          {t("re_extract")}
                        </Button>
                      </div>
                    </div>
                  </details>
                )}

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

          <footer className="bg-muted/30 flex shrink-0 items-center justify-end gap-2 border-t px-4 py-3">
            {step.kind === "input" && (
              <Button onClick={handleExtract} disabled={files.length === 0 && !description.trim()}>
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
                  onClick={() => setStep({ kind: "preview", mode: "edit", result: step.result })}
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
                  onClick={() => setStep({ kind: "preview", mode: "summary", result: step.result })}
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

        {previewImageUrl && (
          <div
            className="animate-in fade-in fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-md duration-200"
            onClick={() => setPreviewImageUrl(null)}
          >
            {/* Close button with premium blur and gold hover accent */}
            <button
              type="button"
              onClick={() => setPreviewImageUrl(null)}
              className="border-warning/30 text-warning/80 hover:border-warning/60 hover:text-warning absolute top-4 right-4 z-[70] rounded-full border bg-black/40 p-2 backdrop-blur-md transition-all hover:scale-105"
              aria-label={t("close_preview")}
            >
              <X className="h-6 w-6" />
            </button>

            {/* Main image container */}
            <div
              className="animate-in zoom-in-95 border-warning/10 relative max-h-[90vh] max-w-[90vw] overflow-hidden rounded-lg border shadow-2xl duration-300"
              onClick={(e) => e.stopPropagation()} // prevent closing when clicking the image
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewImageUrl}
                alt={t("preview_image_alt")}
                className="max-h-[85vh] max-w-[85vw] rounded-md object-contain"
              />
            </div>
          </div>
        )}
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
        <Alert variant="warning" className="rounded-md px-3 py-2 text-xs">
          <AlertTriangle className="size-3.5" />
          <AlertTitle className="font-normal">
            {t("low_confidence_hint", { count: lowConfidenceCount })}
          </AlertTitle>
        </Alert>
      )}
      {warnings.length > 0 && (
        <Alert variant="warning" className="rounded-md px-3 py-2 text-xs">
          {warnings.join("; ")}
        </Alert>
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
              <h3 className="text-muted-foreground text-xs font-medium">
                {t(`section_${kind}` as Parameters<typeof t>[0])} ({list.length})
              </h3>
              <Button variant="ghost" size="sm" onClick={() => onAdd(kind)} className="h-7 text-xs">
                <Plus className="mr-1 h-3 w-3" />
                {t("add_item")}
              </Button>
            </div>
            {list.length === 0 ? (
              <p className="text-muted-foreground text-xs italic">{t("section_empty")}</p>
            ) : (
              <ul className="space-y-1">
                {list.map(({ item, index }) => (
                  <li key={index} className="bg-muted/30 flex items-center gap-1 rounded px-2 py-1">
                    {item.confidence === "low" && (
                      <AlertTriangle
                        className="text-warning h-3.5 w-3.5 shrink-0"
                        aria-label={t("low_confidence_item")}
                      />
                    )}
                    <input
                      value={item.text}
                      onChange={(e) => onUpdate(index, { text: e.target.value })}
                      placeholder={t(`placeholder_${kind}` as Parameters<typeof t>[0])}
                      className="focus:border-border focus:bg-background flex-1 rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-sm focus:outline-none"
                    />
                    <select
                      value={item.cefr ?? ""}
                      onChange={(e) =>
                        onUpdate(index, {
                          cefr: (e.target.value || null) as CefrLevel | null,
                        })
                      }
                      className="text-muted-foreground hover:border-border focus:border-border focus:bg-background rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-xs focus:outline-none"
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

export function IngestToolbarClient({ onOpen }: { onOpen: (trigger: IngestTrigger) => void }) {
  const t = useTranslations("Ingest");
  return (
    <div className="flex shrink-0 items-center gap-1 px-2">
      <button
        type="button"
        onClick={() => onOpen("camera")}
        className="text-muted-foreground hover:text-foreground flex h-9 w-9 items-center justify-center rounded-full transition"
        aria-label={t("trigger_camera")}
      >
        <Camera className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => onOpen("voice")}
        className="text-muted-foreground hover:text-foreground flex h-9 w-9 items-center justify-center rounded-full transition"
        aria-label={t("trigger_voice")}
      >
        <Mic className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => onOpen("file")}
        className="text-muted-foreground hover:text-foreground flex h-9 w-9 items-center justify-center rounded-full transition"
        aria-label={t("trigger_file")}
      >
        <Paperclip className="h-4 w-4" />
      </button>
      <FileText className="hidden" />
    </div>
  );
}
