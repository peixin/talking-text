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
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunksRef = useRef<BlobPart[]>([]);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const recorderMimeRef = useRef<string>("");

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
    } catch {
      setRecordError(t("error_mic_denied"));
      setRecordMode("idle");
    }
  }

  function stopRecording() {
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

    for (const f of arr) {
      if (next.length >= 5) {
        limitWarning = true;
        break;
      }
      if (f.size > 10 * 1024 * 1024) {
        sizeWarning = true;
        continue;
      }
      if (currentTotalSize + f.size > 10 * 1024 * 1024) {
        sizeWarning = true;
        continue;
      }
      next.push(f);
      currentTotalSize += f.size;
    }
    setFiles(next);

    if (limitWarning) {
      triggerWarning(t("warning_limit_reached"));
    } else if (sizeWarning) {
      triggerWarning(t("warning_size_reached"));
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
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => cameraInputRef.current?.click()}
                  >
                    <Camera className="mr-2 h-4 w-4" />
                    {t("take_photo")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                    <ImageIcon className="mr-2 h-4 w-4" />
                    {t("upload_images")}
                  </Button>
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
                  <div className="animate-in fade-in slide-in-from-top-1 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 shadow-sm duration-200 dark:border-amber-500/20 dark:bg-amber-500/5 dark:text-amber-300">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <span className="flex-1 font-medium">{warningMessage}</span>
                    <button
                      type="button"
                      onClick={() => setWarningMessage(null)}
                      className="text-amber-800/60 hover:text-amber-800 dark:text-amber-300/60 dark:hover:text-amber-300"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
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
                    rows={2}
                    className="border-border bg-background focus:ring-ring w-full resize-none rounded-md border px-3 py-2 text-sm focus:ring-1 focus:outline-none"
                  />
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
                <div className="space-y-2 rounded-xl border border-indigo-500/10 bg-indigo-500/5 p-4">
                  <label className="block text-[10px] font-bold tracking-wider text-indigo-800 uppercase">
                    {t("capture_name_label")}
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={step.kind === "saving"}
                    placeholder={t("capture_name_placeholder")}
                    className="bg-background border-border w-full rounded-lg border px-3 py-1.5 text-sm font-medium outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
                  />
                </div>

                {/* CEFR Level Selection */}
                <div className="space-y-1">
                  <label className="block text-[10px] font-bold tracking-wider text-indigo-800 uppercase">
                    推算难度等级 (CEFR)
                  </label>
                  <select
                    value={inferredCefr || ""}
                    onChange={(e) => setInferredCefr(e.target.value || null)}
                    disabled={step.kind === "saving"}
                    className="border-border bg-background focus:ring-ring w-full rounded-lg border px-3 py-1.5 text-sm outline-none focus:ring-1 disabled:opacity-50"
                  >
                    <option value="">(由AI自适应)</option>
                    {CEFR_OPTIONS.filter(Boolean).map((lvl) => (
                      <option key={lvl} value={lvl}>
                        {lvl} (标准 {lvl} 级)
                      </option>
                    ))}
                  </select>
                </div>

                {/* 我的说明 / 要求 — separated from the content by the AI. Saved as the
                    group's prompt_notes; it steers the AI teacher, never becomes items. */}
                <div className="space-y-1.5 rounded-xl border border-emerald-500/15 bg-emerald-500/5 p-4">
                  <label className="flex items-center gap-1.5 text-[10px] font-bold tracking-wider text-emerald-800 uppercase">
                    我的说明 · 要求
                    <span className="rounded bg-emerald-100 px-1.5 py-px text-[8px] font-bold tracking-normal text-emerald-700 normal-case dark:bg-emerald-950/40">
                      AI 已从内容中分离
                    </span>
                  </label>
                  <textarea
                    value={parentNote}
                    onChange={(e) => setParentNote(e.target.value)}
                    disabled={step.kind === "saving"}
                    placeholder="你对这份素材的说明、要求或批注（任意语言）。例如：这是第3单元生词，重点练 r 发音。仅用于指导 AI 老师，不会被当作学习内容。"
                    rows={2}
                    className="bg-background border-border w-full resize-y rounded-lg border px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-50"
                  />
                </div>

                {/* 📝 底稿微调与重新分析 (Start with Vision, Refine with Text) */}
                {step.kind === "preview" && (
                  <details className="group rounded-xl border border-slate-500/10 bg-slate-500/5 p-4 transition-all duration-200 open:border-slate-500/20 open:bg-slate-500/10">
                    <summary className="flex cursor-pointer items-center justify-between text-[10px] font-bold tracking-wider text-slate-700 uppercase outline-none select-none">
                      <span className="flex items-center gap-1.5">
                        <FileText className="h-3.5 w-3.5" />
                        底稿与二次微调 (AI OCR Draft)
                      </span>
                      <span className="text-[9px] font-normal text-slate-500 group-open:hidden">
                        点击展开编辑
                      </span>
                    </summary>
                    <div className="mt-3 space-y-3">
                      <textarea
                        value={rawText}
                        onChange={(e) => setRawText(e.target.value)}
                        placeholder="在此修改由 Vision 提取的原始教材文本，微调 OCR 错误..."
                        rows={6}
                        className="bg-background border-border w-full resize-y rounded-lg border p-3 font-mono text-xs leading-relaxed outline-none focus:ring-1 focus:ring-slate-500"
                      />
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={!rawText.trim()}
                          onClick={handleReExtract}
                          className="h-8 gap-1.5 border border-indigo-500/20 bg-indigo-500/5 text-xs font-medium text-indigo-700 transition-all hover:bg-indigo-500/10 active:scale-[0.98]"
                        >
                          ✨ 重新提取 (Re-extract)
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
              className="absolute top-4 right-4 z-[70] rounded-full border border-yellow-500/30 bg-black/40 p-2 text-yellow-500/80 backdrop-blur-md transition-all hover:scale-105 hover:border-yellow-500/60 hover:text-yellow-400"
              aria-label="关闭预览"
            >
              <X className="h-6 w-6" />
            </button>

            {/* Main image container */}
            <div
              className="animate-in zoom-in-95 relative max-h-[90vh] max-w-[90vw] overflow-hidden rounded-lg border border-yellow-500/10 shadow-2xl duration-300"
              onClick={(e) => e.stopPropagation()} // prevent closing when clicking the image
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewImageUrl}
                alt="教材预览"
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
                        className="h-3.5 w-3.5 shrink-0 text-amber-600"
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
