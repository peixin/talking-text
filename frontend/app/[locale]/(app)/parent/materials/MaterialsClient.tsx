"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  BookOpen,
  Bookmark,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  Image as ImageIcon,
  Inbox,
  Loader2,
  MessageSquare,
  Mic,
  MicOff,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CefrLevel, ExtractedItem, GroupOut, IngestionResult, ItemType } from "@/lib/backend";
import { archiveGroup, deleteGroup, createGroup, startSessionFromGroupAction } from "./actions";
import {
  transcribeIngestion,
  extractIngestion,
} from "@/app/[locale]/(app)/chat/[sessionId]/actions";
import { Link } from "@/i18n/routing";
import { useKindLabel } from "./MaterialPickersClient";

const KIND_ICON: Record<string, typeof BookOpen> = {
  textbook_book: BookOpen,
  textbook_unit: Sparkles,
  textbook_lesson: Zap,
  personal_collection: Bookmark,
  quick_practice: Zap,
  review_set: Bookmark,
};

interface Props {
  groups: GroupOut[];
}

interface GroupNode {
  group: GroupOut;
  children: GroupNode[];
}

type Step =
  | { kind: "input" }
  | { kind: "extracting" }
  | { kind: "preview"; result: IngestionResult }
  | { kind: "saving" }
  | { kind: "error"; message: string };

const CEFR_OPTIONS = ["", "A1", "A2", "B1", "B2", "C1", "C2"];

export function MaterialsClient({ groups: initialGroups }: Props) {
  const t = useTranslations("Materials");
  const tIngest = useTranslations("Ingest");
  const kindLabel = useKindLabel();
  const router = useRouter();
  const [groups, setGroups] = useState<GroupOut[]>(initialGroups);
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  // Smart Ingest Dialog State
  const [isIngestOpen, setIsIngestOpen] = useState(false);
  const [step, setStep] = useState<Step>({ kind: "input" });
  const [files, setFiles] = useState<File[]>([]);
  const [description, setDescription] = useState("");

  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const warningTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Transformed details inside preview step. Capture is a flat bag: just a name,
  // no hierarchy — structuring is a separate step. See docs/content-lifecycle.md §3.
  const [extractedItems, setExtractedItems] = useState<ExtractedItem[]>([]);
  const [name, setName] = useState<string>("");
  const [inferredCefr, setInferredCefr] = useState<string | null>(null);

  // Audio Recorder State
  const [recordMode, setRecordMode] = useState<"idle" | "recording" | "transcribing">("idle");
  const [recordError, setRecordError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunksRef = useRef<BlobPart[]>([]);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const recorderMimeRef = useRef<string>("");

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  // Set initial state on list updates
  useEffect(() => {
    const timer = setTimeout(() => {
      setGroups(initialGroups);
    }, 0);
    return () => clearTimeout(timer);
  }, [initialGroups]);

  // Recursively build textbook trees
  const activeTree = useMemo(() => {
    const active = groups.filter((g) => !g.archived);
    const map = new Map<string, GroupNode>();
    const roots: GroupNode[] = [];

    active.forEach((g) => {
      map.set(g.id, { group: g, children: [] });
    });

    active.forEach((g) => {
      const node = map.get(g.id)!;
      if (g.parent_id && map.has(g.parent_id)) {
        map.get(g.parent_id)!.children.push(node);
      } else {
        roots.push(node);
      }
    });

    return roots;
  }, [groups]);

  // Canonical textbook trees vs. un-organized capture bags (the latter go to the
  // organize workbench). Splitting them makes the tag tree actually visible.
  const canonicalRoots = useMemo(
    () => activeTree.filter((n) => n.group.kind !== "quick_practice"),
    [activeTree],
  );
  const captureRoots = useMemo(
    () => activeTree.filter((n) => n.group.kind === "quick_practice"),
    [activeTree],
  );

  const archivedGroups = useMemo(() => {
    return groups.filter((g) => g.archived);
  }, [groups]);

  // Audio Remux helpers
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

  function handleOpenChange(open: boolean) {
    if (open) {
      setStep({ kind: "input" });
      setFiles([]);
      setDescription("");
      setExtractedItems([]);
      setWarningMessage(null);
      setPreviewImageUrl(null);
      setName("");
      setInferredCefr(null);
      if (warningTimeoutRef.current) {
        clearTimeout(warningTimeoutRef.current);
        warningTimeoutRef.current = null;
      }
      setIsIngestOpen(true);
    } else {
      setIsIngestOpen(false);
      stopRecorderStream();
      setWarningMessage(null);
      setPreviewImageUrl(null);
      setName("");
      setInferredCefr(null);
      if (warningTimeoutRef.current) {
        clearTimeout(warningTimeoutRef.current);
        warningTimeoutRef.current = null;
      }
    }
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
      setRecordError("麦克风权限被拒绝，无法录音");
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
      setRecordError("录音文件为空，请重试");
      setRecordMode("idle");
      return;
    }
    const fd = new FormData();
    const ext = (recorderMimeRef.current || "audio/webm").includes("mp4") ? "mp4" : "webm";
    fd.append("audio", blob, `voice.${ext}`);
    const result = await transcribeIngestion(fd);
    if (!result.ok) {
      setRecordError(result.error || "语音识别失败，请手动输入或重试");
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
      triggerWarning(tIngest("warning_limit_reached"));
    } else if (sizeWarning) {
      triggerWarning(tIngest("warning_size_reached"));
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

  // Handle core AI extraction
  async function handleExtract() {
    if (files.length === 0 && !description.trim()) {
      setStep({ kind: "error", message: "请提供课本照片、录音或手动输入描述" });
      return;
    }
    setStep({ kind: "extracting" });
    const fd = new FormData();
    if (description.trim()) fd.append("description", description.trim());
    for (const f of files) fd.append("images", f, f.name);

    const res = await extractIngestion(fd);
    if (!res.ok) {
      setStep({ kind: "error", message: res.error || "智能解析失败，请检查网络并重试" });
      return;
    }

    const { result } = res;
    setExtractedItems(result.items);

    const meta = result.metadata;
    setName((meta.suggested_name || "").trim());
    setInferredCefr(meta.cefr_level);

    setStep({ kind: "preview", result });
  }

  // Saving smart creation
  async function handleSaveExtracted() {
    setStep({ kind: "saving" });
    const formattedItems = extractedItems
      .filter((i) => i.text.trim().length > 0)
      .map((i) => ({
        text: i.text.trim(),
        type: i.type,
        anchor: i.anchor || null,
        cefr_level: i.cefr || null,
        pos: i.pos || null,
      }));

    const res = await createGroup({
      name: name.trim() || "未分类教材",
      kind: "quick_practice",
      items: formattedItems,
    });

    if (res.ok) {
      setGroups((prev) => [res.group, ...prev]);
      handleOpenChange(false);
      router.refresh();
    } else {
      setStep({ kind: "error", message: res.error || "保存失败，请稍后重试" });
    }
  }

  // Trigger fast chat session
  function handleStartSession(groupId: string) {
    setBusy(groupId);
    startTransition(async () => {
      const res = await startSessionFromGroupAction(groupId);
      setBusy(null);
      if (res.ok) {
        router.push(`/chat/${res.sessionId}`);
      } else {
        alert(`开始练习失败: ${res.error}`);
      }
    });
  }

  function handleToggleArchive(g: GroupOut) {
    setBusy(g.id);
    startTransition(async () => {
      const res = await archiveGroup(g.id, !g.archived);
      if (res.ok) {
        setGroups((prev) => prev.map((x) => (x.id === g.id ? { ...x, archived: !x.archived } : x)));
      }
      setBusy(null);
    });
  }

  function confirmDelete(g: GroupOut) {
    if (!confirm(t("confirm_delete", { name: g.name }))) return;
    setBusy(g.id);
    startTransition(async () => {
      const res = await deleteGroup(g.id);
      if (res.ok) {
        setGroups((prev) => prev.filter((x) => x.id !== g.id));
      }
      setBusy(null);
    });
  }

  return (
    <div className="space-y-6">
      {/* Top Banner with Action trigger */}
      <div className="relative flex flex-col items-start justify-between gap-4 overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 to-indigo-950 p-6 text-white shadow-lg sm:flex-row sm:items-center">
        {/* Subtle decorative background bubbles */}
        <div className="pointer-events-none absolute top-0 right-0 h-44 w-44 rounded-full bg-indigo-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-10 left-10 h-24 w-24 rounded-full bg-pink-500/10 blur-2xl" />

        <div className="relative z-10 space-y-1">
          <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-wide">
            <Sparkles className="h-5 w-5 animate-pulse text-indigo-400" />
            三位一体智能录入
          </h2>
          <p className="max-w-md text-xs text-slate-300">
            拍照、语音或手动输入，AI 识别出单词、短语和句型；之后在「整理素材」里一键归位成教材。
          </p>
        </div>

        <Button
          onClick={() => {
            handleOpenChange(true);
          }}
          className="group relative z-10 shrink-0 border border-slate-200 bg-white font-semibold text-slate-950 shadow-md hover:bg-slate-100"
          size="sm"
        >
          <Plus className="mr-1.5 h-4 w-4 text-indigo-600 transition-transform duration-200 group-hover:rotate-90" />
          智能录入新教材
        </Button>
      </div>

      {/* Un-organized capture bags → go to the organize workbench */}
      {captureRoots.length > 0 && (
        <section className="space-y-3 rounded-2xl border border-amber-300/60 bg-amber-50/40 p-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-sm font-bold text-amber-700">
              <Inbox className="h-4 w-4" />
              待整理采集（{captureRoots.length} 袋）
            </h3>
            <Link
              href="/parent/organize"
              className="text-sm font-medium text-amber-700 transition hover:text-amber-900"
            >
              去整理 →
            </Link>
          </div>
          <div className="flex flex-wrap gap-2">
            {captureRoots.map((n) => (
              <span
                key={n.group.id}
                className="border-border bg-background inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs"
              >
                {n.group.name}
                <span className="text-muted-foreground">{n.group.item_count} 词</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Canonical textbook tag tree */}
      <section className="space-y-3">
        <div className="flex items-center justify-between border-b pb-2">
          <h3 className="text-foreground flex items-center gap-1.5 text-sm font-bold">
            <BookOpen className="h-4 w-4 text-slate-500" />
            教材结构
          </h3>
          <span className="text-muted-foreground text-xs">{canonicalRoots.length} 本教材</span>
        </div>

        {canonicalRoots.length === 0 ? (
          <div className="text-muted-foreground bg-card/20 rounded-2xl border border-dashed p-10 text-center text-sm shadow-inner">
            <Bookmark className="mx-auto mb-2 h-8 w-8 text-slate-300" />
            <p className="font-semibold text-slate-400">还没有成形的教材</p>
            <p className="mt-1 text-xs text-slate-400">
              先「智能录入」采集素材，再去「整理素材」把它们归位成教材标签树。
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {canonicalRoots.map((node) => (
              <TreeViewNode
                key={node.group.id}
                node={node}
                depth={0}
                busy={busy}
                kindLabel={kindLabel}
                onStartSession={handleStartSession}
                onArchive={handleToggleArchive}
                onDelete={confirmDelete}
              />
            ))}
          </div>
        )}
      </section>

      {/* Archived Section */}
      {archivedGroups.length > 0 && (
        <section className="space-y-3 border-t pt-4">
          <h3 className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold">
            <Archive className="h-3.5 w-3.5" />
            已归档素材 ({archivedGroups.length})
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {archivedGroups.map((g) => (
              <div
                key={g.id}
                className="bg-card/40 flex items-center justify-between rounded-xl border p-3 opacity-60 transition-opacity hover:opacity-90"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-foreground truncate text-sm font-semibold">{g.name}</p>
                  <p className="text-muted-foreground text-[10px]">
                    {g.item_count} 个学习点 · {kindLabel(g.kind)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleToggleArchive(g)}
                    disabled={busy === g.id}
                    title="恢复"
                  >
                    <ArchiveRestore className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => confirmDelete(g)}
                    disabled={busy === g.id}
                    className="hover:text-destructive text-muted-foreground"
                    title="删除"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Ingestion Drawer Dialog Overlay */}
      <DialogPrimitive.Root open={isIngestOpen} onOpenChange={handleOpenChange}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Backdrop className="data-[state=open]:animate-in data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/60 backdrop-blur-sm duration-150" />
          <DialogPrimitive.Popup className="bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=open]:zoom-in-95 fixed inset-x-4 bottom-4 z-50 mx-auto flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border shadow-2xl duration-200 outline-none sm:inset-x-0 sm:top-[10%] sm:bottom-auto">
            {/* Header */}
            <header className="flex shrink-0 items-center justify-between border-b px-6 py-4">
              <DialogPrimitive.Title className="text-foreground flex items-center gap-1.5 text-base font-bold tracking-tight">
                <Sparkles className="h-5 w-5 text-indigo-500" />
                三合一智能多维录入
              </DialogPrimitive.Title>
              <DialogPrimitive.Close
                render={
                  <Button variant="ghost" size="icon-sm" aria-label="关闭">
                    <X className="h-4 w-4" />
                  </Button>
                }
              />
            </header>

            {/* Content Body */}
            <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
              {/* STEP 1: Input controls */}
              {step.kind === "input" && (
                <div className="space-y-4" onPaste={handlePaste}>
                  <div className="flex flex-wrap gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => cameraInputRef.current?.click()}
                      className="border-indigo-100 hover:bg-indigo-50 hover:text-indigo-900"
                    >
                      <Camera className="mr-1.5 h-4 w-4 text-indigo-600" />
                      相机拍照
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      className="border-indigo-100 hover:bg-indigo-50 hover:text-indigo-900"
                    >
                      <ImageIcon className="mr-1.5 h-4 w-4 text-indigo-600" />
                      选取课本照片
                    </Button>
                    <Button
                      type="button"
                      variant={recordMode === "recording" ? "destructive" : "outline"}
                      size="sm"
                      onClick={handleRecordToggle}
                      disabled={recordMode === "transcribing"}
                      className={cn(
                        recordMode !== "recording" &&
                          "border-indigo-100 hover:bg-indigo-50 hover:text-indigo-900",
                      )}
                    >
                      {recordMode === "recording" ? (
                        <>
                          <MicOff className="mr-1.5 h-4 w-4 animate-bounce" />
                          停止语音录音
                        </>
                      ) : recordMode === "transcribing" ? (
                        <>
                          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                          语音转换中...
                        </>
                      ) : (
                        <>
                          <Mic className="mr-1.5 h-4 w-4 animate-pulse text-indigo-600" />
                          说一段话描述教材
                        </>
                      )}
                    </Button>
                  </div>

                  {recordError && (
                    <div className="text-destructive bg-destructive/10 rounded px-2 py-1 text-xs">
                      {recordError}
                    </div>
                  )}

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

                  {/* Hidden fields */}
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

                  {/* Image previews */}
                  {previews.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-2">
                      {previews.map((p, i) => (
                        <div
                          key={p.url}
                          className="group bg-muted relative h-20 w-20 overflow-hidden rounded-xl border shadow-sm"
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
                            className="animate-in fade-in absolute top-1 right-1 rounded-full bg-black/75 p-1 text-white opacity-0 shadow-md transition duration-150 group-hover:opacity-100"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Typed Description Textarea */}
                  <div className="space-y-1">
                    <label className="text-muted-foreground flex items-center gap-1 text-xs font-bold">
                      手动备注/语音输入结果
                      <span title="语音转文字的内容也会即时追加在这里，你可以进行手动校正或扩充。">
                        <HelpCircle className="h-3 w-3 text-slate-400" />
                      </span>
                    </label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="您可以输入对本教材的文字描述。如果是语音识别到的文字，可在这里直接进行二次校对、修改或丰富。"
                      rows={5}
                      className="border-input bg-background focus:ring-ring w-full resize-none rounded-xl border px-3 py-2 text-sm shadow-sm outline-none focus:ring-1"
                    />
                  </div>
                </div>
              )}

              {/* STEP 2: Analyzing shimmers */}
              {step.kind === "extracting" && (
                <div className="flex flex-col items-center justify-center space-y-4 py-10">
                  <div className="relative">
                    <div className="h-16 w-16 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
                    <Sparkles className="absolute inset-0 m-auto h-6 w-6 animate-bounce text-indigo-500" />
                  </div>
                  <div className="space-y-2 text-center">
                    <p className="text-foreground text-sm font-bold">
                      大模型正在智能进行三合一解析中...
                    </p>
                    <p className="text-muted-foreground max-w-xs text-xs leading-relaxed">
                      正在将图片文字、语音转译与文本描述结合，并跨本地数据库进行相似书名检索和层级匹配...
                    </p>
                  </div>
                </div>
              )}

              {/* STEP 3: Ingestion Error */}
              {step.kind === "error" && (
                <div className="space-y-4 py-8 text-center">
                  <div className="bg-destructive/10 text-destructive mx-auto flex h-12 w-12 items-center justify-center rounded-full text-xl font-bold">
                    !
                  </div>
                  <div className="space-y-1">
                    <p className="text-foreground text-sm font-bold">解析失败</p>
                    <p className="text-destructive mx-auto max-w-sm text-xs">{step.message}</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setStep({ kind: "input" })}>
                    返回重新录入
                  </Button>
                </div>
              )}

              {/* STEP 4: Review and confirmation panel */}
              {step.kind === "preview" && (
                <div className="space-y-5">
                  <div className="space-y-4 rounded-xl border border-indigo-500/10 bg-indigo-500/5 p-4">
                    {/* Capture name — a flat bag. Organizing into a textbook tree
                        is a separate step in the organize workbench. */}
                    <div className="space-y-2">
                      <label className="block text-[10px] font-bold tracking-wider text-indigo-800 uppercase">
                        给这一组起个名
                      </label>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="如：Unit 3 单词、动物"
                        className="bg-background border-border w-full rounded-lg border px-3 py-1.5 text-sm font-medium outline-none focus:ring-1 focus:ring-indigo-500"
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
                        className="bg-background focus:ring-ring w-full rounded-lg border px-3 py-1.5 text-sm outline-none focus:ring-1"
                      >
                        <option value="">(由AI自适应)</option>
                        {CEFR_OPTIONS.filter(Boolean).map((lvl) => (
                          <option key={lvl} value={lvl}>
                            {lvl} (标准 {lvl} 级)
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Extracted vocabulary items list */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between border-b pb-1.5">
                      <h4 className="text-foreground flex items-center gap-1.5 text-xs font-bold">
                        <Check className="h-4 w-4 text-emerald-500" />
                        提取的学习点 ({extractedItems.length} 个)
                      </h4>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setExtractedItems((prev) => [
                            ...prev,
                            {
                              text: "",
                              type: "word",
                              anchor: null,
                              cefr: null,
                              pos: null,
                              confidence: "high",
                              note: null,
                            },
                          ])
                        }
                        className="h-7 text-xs text-indigo-600 hover:text-indigo-700"
                      >
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        手动添加点
                      </Button>
                    </div>

                    <div className="max-h-64 space-y-2 divide-y overflow-y-auto pr-1">
                      {extractedItems.map((item, idx) => (
                        <div
                          key={idx}
                          className="flex flex-col gap-2 py-2 text-xs sm:flex-row sm:items-center"
                        >
                          <input
                            type="text"
                            value={item.text}
                            onChange={(e) =>
                              setExtractedItems((prev) =>
                                prev.map((it, i) =>
                                  i === idx ? { ...it, text: e.target.value } : it,
                                ),
                              )
                            }
                            placeholder="条目文本"
                            className="bg-background flex-[2] rounded border px-2 py-1"
                          />
                          <select
                            value={item.type}
                            onChange={(e) =>
                              setExtractedItems((prev) =>
                                prev.map((it, i) =>
                                  i === idx ? { ...it, type: e.target.value as ItemType } : it,
                                ),
                              )
                            }
                            className="bg-background shrink-0 rounded border px-2 py-1"
                          >
                            <option value="word">单词 (Word)</option>
                            <option value="phrase">短语 (Phrase)</option>
                            <option value="pattern">句型 (Pattern)</option>
                          </select>
                          {item.type === "pattern" && (
                            <input
                              type="text"
                              value={item.anchor || ""}
                              onChange={(e) =>
                                setExtractedItems((prev) =>
                                  prev.map((it, i) =>
                                    i === idx ? { ...it, anchor: e.target.value } : it,
                                  ),
                                )
                              }
                              placeholder="句型锚点(如: can you)"
                              className="bg-background flex-1 rounded border px-2 py-1"
                            />
                          )}
                          <select
                            value={item.cefr || ""}
                            onChange={(e) =>
                              setExtractedItems((prev) =>
                                prev.map((it, i) =>
                                  i === idx
                                    ? { ...it, cefr: (e.target.value as CefrLevel) || null }
                                    : it,
                                ),
                              )
                            }
                            className="bg-background shrink-0 rounded border px-2 py-1"
                          >
                            <option value="">难度</option>
                            {CEFR_OPTIONS.filter(Boolean).map((lvl) => (
                              <option key={lvl} value={lvl}>
                                {lvl}
                              </option>
                            ))}
                          </select>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() =>
                              setExtractedItems((prev) => prev.filter((_, i) => i !== idx))
                            }
                            className="text-muted-foreground hover:text-destructive shrink-0 self-end sm:self-auto"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 5: Saving database indicator */}
              {step.kind === "saving" && (
                <div className="flex flex-col items-center justify-center space-y-4 py-10">
                  <Loader2 className="h-10 w-10 animate-spin text-indigo-600" />
                  <p className="text-foreground text-sm font-bold">正在同步至本地教材库...</p>
                </div>
              )}
            </div>

            {/* Footer Control buttons */}
            <footer className="bg-muted/40 flex shrink-0 items-center justify-end gap-3 rounded-b-2xl border-t px-6 py-4">
              {step.kind === "input" && (
                <>
                  <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)}>
                    取消
                  </Button>
                  <Button
                    onClick={handleExtract}
                    disabled={files.length === 0 && !description.trim()}
                    size="sm"
                    className="bg-indigo-600 font-semibold text-white hover:bg-indigo-700"
                  >
                    开始智能分析
                  </Button>
                </>
              )}

              {step.kind === "preview" && (
                <>
                  <Button variant="outline" size="sm" onClick={() => setStep({ kind: "input" })}>
                    返回修改输入
                  </Button>
                  <Button
                    onClick={handleSaveExtracted}
                    disabled={extractedItems.filter((i) => i.text.trim().length > 0).length === 0}
                    size="sm"
                    className="bg-emerald-600 font-semibold text-white hover:bg-emerald-700"
                  >
                    确认录入教材库
                  </Button>
                </>
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
    </div>
  );
}

// Beautiful recursive tree rendering component
function TreeViewNode({
  node,
  depth,
  busy,
  kindLabel,
  onStartSession,
  onArchive,
  onDelete,
}: {
  node: GroupNode;
  depth: number;
  busy: string | null;
  kindLabel: (kind: string) => string;
  onStartSession: (id: string) => void;
  onArchive: (g: GroupOut) => void;
  onDelete: (g: GroupOut) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const { group, children } = node;

  const Icon = KIND_ICON[group.kind] ?? Bookmark;
  const isBusy = busy === group.id;

  return (
    <div className="space-y-2">
      {/* Container card */}
      <div
        className={cn(
          "group flex flex-col gap-3 rounded-xl border p-4 transition-all duration-200 sm:flex-row sm:items-center sm:justify-between",
          depth === 0
            ? "bg-card border-slate-200/80 shadow-sm hover:border-slate-300"
            : depth === 1
              ? "bg-card/75 relative ml-3 border-slate-100 hover:border-indigo-100 hover:bg-indigo-50/10 sm:ml-6"
              : "bg-card/40 relative ml-6 border-dashed border-slate-200 hover:border-indigo-200 hover:bg-indigo-50/20 sm:ml-12",
          isBusy ? "pointer-events-none opacity-50" : "",
        )}
      >
        {/* Visual guide line */}
        {depth > 0 && (
          <div
            className="pointer-events-none absolute top-1/2 -left-3 h-[2px] w-3 bg-slate-200"
            style={{ transform: "translateY(-50%)" }}
          />
        )}
        {depth > 0 && (
          <div
            className="pointer-events-none absolute top-0 -left-3 h-full w-[2px] bg-slate-200"
            style={{ height: children.length > 0 && expanded ? "50%" : "100%" }}
          />
        )}

        <div className="flex min-w-0 items-center gap-3">
          {/* Collapse/Expand indicator */}
          {children.length > 0 ? (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-muted-foreground hover:text-foreground hover:bg-muted shrink-0 rounded p-0.5"
            >
              {expanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          ) : (
            <div className="w-5 shrink-0" />
          )}

          {/* Type Badge icon */}
          <div
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border shadow-sm",
              depth === 0
                ? "border-slate-200 bg-slate-100 text-slate-800"
                : depth === 1
                  ? "border-indigo-100 bg-indigo-50 text-indigo-800"
                  : "border-emerald-100 bg-emerald-50 text-emerald-800",
            )}
          >
            <Icon className="h-4 w-4" />
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-foreground truncate text-sm leading-tight font-bold">
                {group.name}
              </span>
              <span className="py-0.2 shrink-0 rounded bg-slate-100 px-1 text-[10px] font-semibold text-slate-500">
                {kindLabel(group.kind)}
              </span>
            </div>
            <span className="text-muted-foreground mt-0.5 block text-[10px]">
              {group.item_count} 个重点学习词句{" "}
              {group.source_book_hint && `· ${group.source_book_hint}`}
            </span>
          </div>
        </div>

        {/* Action button triggers */}
        <div className="flex shrink-0 flex-wrap items-center gap-1 sm:ml-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onStartSession(group.id)}
            disabled={isBusy}
            className="flex h-8 shrink-0 items-center border-indigo-100 text-xs font-semibold text-indigo-700 shadow-sm hover:bg-indigo-50 hover:text-indigo-800"
          >
            {isBusy ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <MessageSquare className="mr-1 h-3.5 w-3.5 text-indigo-500" />
            )}
            对话练习
          </Button>

          {/* Edit detailed material */}
          <Link href={`/parent/materials/${group.id}`}>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground shrink-0"
              title="编辑详细词表"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </Link>

          {/* Archive material */}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onArchive(group)}
            disabled={isBusy}
            className="text-muted-foreground hover:text-foreground shrink-0"
            title="归档"
          >
            <Archive className="h-3.5 w-3.5" />
          </Button>

          {/* Delete material */}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onDelete(group)}
            disabled={isBusy}
            className="hover:text-destructive text-muted-foreground shrink-0"
            title="彻底删除"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Recurse children */}
      {children.length > 0 && expanded && (
        <div className="space-y-2">
          {children.map((child) => (
            <TreeViewNode
              key={child.group.id}
              node={child}
              depth={depth + 1}
              busy={busy}
              kindLabel={kindLabel}
              onStartSession={onStartSession}
              onArchive={onArchive}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
