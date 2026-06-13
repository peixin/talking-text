"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  FolderInput,
  Loader2,
  Sparkles,
  Wand2,
  Plus,
  X,
  ArrowLeft,
  ArrowRight,
  FileText,
  Edit3,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/utils";
import type { GroupOut, InboxBag, InboxCandidate, InboxOut } from "@/lib/backend";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { LEVEL_PRESETS } from "@/lib/constants";
import { createGroup, deleteGroup } from "../materials/actions";
import {
  fileBag,
  reloadWorkbench,
  suggestBag,
  extractIngestionAction,
  updateGroupAction,
} from "./actions";

const SEP = " › ";
const CAPTURE_KIND = "quick_practice";

function splitPath(s: string): string[] {
  return s
    .split(/›|\/|>/)
    .map((x) => x.trim())
    .filter(Boolean);
}

interface Props {
  initialInbox: InboxOut;
  groups: GroupOut[];
}

export function OrganizeWorkbenchClient({ initialInbox, groups: initialGroups }: Props) {
  const t = useTranslations("Organize");
  const [bags, setBags] = useState<InboxBag[]>(initialInbox.capture_bags);
  const [candidates, setCandidates] = useState<InboxCandidate[]>(initialInbox.practice_candidates);
  const [groups, setGroups] = useState<GroupOut[]>(initialGroups);
  const [paths, setPaths] = useState<Record<string, Array<{ name: string; level_title: string }>>>(
    () => {
      const init: Record<string, Array<{ name: string; level_title: string }>> = {};
      for (const bag of initialInbox.capture_bags) {
        init[bag.group_id] = [{ name: bag.name, level_title: bag.level_title || LEVEL_PRESETS[0] }];
      }
      return init;
    },
  );
  const [bagRawTexts, setBagRawTexts] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const bag of initialInbox.capture_bags) {
      init[bag.group_id] = bag.source_raw_text || "";
    }
    return init;
  });
  const [extractingBags, setExtractingBags] = useState<Record<string, boolean>>({});
  const [suggesting, setSuggesting] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null); // bag id, or "candidates"
  const [candPath, setCandPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [activePopover, setActivePopover] = useState<{ bagId: string; idx: number } | null>(null);
  const [activeLevelTitlePopover, setActiveLevelTitlePopover] = useState<{
    bagId: string;
    idx: number;
  } | null>(null);

  // Autocomplete selections based on matching database directories for a specific bag
  function getAutocompleteOptions(bagId: string, idx: number): string[] {
    const currentPath = paths[bagId] || [];
    if (idx === 0) {
      return Array.from(
        new Set(
          groups
            .filter((g) => !g.parent_id && !g.archived && g.kind !== CAPTURE_KIND)
            .map((g) => g.name),
        ),
      );
    }
    let currentGroupNodes = groups.filter(
      (g) => !g.parent_id && !g.archived && g.kind !== CAPTURE_KIND,
    );
    for (let i = 0; i < idx; i++) {
      const parentName = currentPath[i]?.name.trim().toLowerCase();
      if (!parentName) return [];
      const matchedNode = currentGroupNodes.find((g) => g.name.trim().toLowerCase() === parentName);
      if (!matchedNode) return [];
      currentGroupNodes = groups.filter(
        (g) => g.parent_id === matchedNode.id && !g.archived && g.kind !== CAPTURE_KIND,
      );
    }
    return Array.from(new Set(currentGroupNodes.map((g) => g.name)));
  }

  // TODO: confirm whether this helper is still needed once the "auto-sync
  // level_title to existing nodes after filing" feature is built. Delete if
  // still unused at that point.
  function getMatchedGroupNode(bagId: string, idx: number): GroupOut | null {
    const currentPath = paths[bagId] || [];
    let currentGroupNodes = groups.filter(
      (g) => !g.parent_id && !g.archived && g.kind !== CAPTURE_KIND,
    );
    let matched: GroupOut | null = null;
    for (let i = 0; i <= idx; i++) {
      const currentName = currentPath[i]?.name.trim().toLowerCase();
      if (!currentName) return null;
      const matchedNode = currentGroupNodes.find(
        (g) => g.name.trim().toLowerCase() === currentName,
      );
      if (!matchedNode) return null;
      matched = matchedNode;
      currentGroupNodes = groups.filter(
        (g) => g.parent_id === matchedNode.id && !g.archived && g.kind !== CAPTURE_KIND,
      );
    }
    return matched;
  }

  // AI pre-predicts a path for every bag on mount (default = bag name; AI refines
  // to reuse existing structure). The human just tweaks — ~80% done automatically.
  // Initial state is set via lazy useState initializers above, NOT here, to avoid
  // the react-hooks/set-state-in-effect lint rule.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      for (const bag of initialInbox.capture_bags) {
        setSuggesting((s) => ({ ...s, [bag.group_id]: true }));
        const res = await suggestBag(bag.group_id);
        if (cancelled) return;
        setPaths((p) => ({
          ...p,
          [bag.group_id]: res.ok
            ? res.tag_path.map((val, i) => ({
                name: val,
                level_title:
                  res.level_titles && i < res.level_titles.length && res.level_titles[i]
                    ? res.level_titles[i]
                    : i === 0 && bag.level_title
                      ? bag.level_title
                      : LEVEL_PRESETS[i] || t("level_fallback", { n: i + 1 }),
              }))
            : [
                {
                  name: bag.name,
                  level_title: bag.level_title || LEVEL_PRESETS[0],
                },
              ],
        }));
        setSuggesting((s) => ({ ...s, [bag.group_id]: false }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  const existingPaths = useMemo(() => {
    const canon = groups.filter((g) => g.kind !== CAPTURE_KIND && !g.archived);
    const byId = new Map(canon.map((g) => [g.id, g]));
    const pathOf = (g: GroupOut): string => {
      const names: string[] = [];
      let cur: GroupOut | undefined = g;
      const seen = new Set<string>();
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        names.unshift(cur.name);
        cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
      }
      return names.join(SEP);
    };
    return [...new Set(canon.map(pathOf))].sort();
  }, [groups]);

  async function syncFromServer() {
    const r = await reloadWorkbench();
    if (r.ok) {
      setGroups(r.groups);
      setBags(r.inbox.capture_bags);
      setCandidates(r.inbox.practice_candidates);
    }
  }

  async function doFileBag(bag: InboxBag) {
    const partsObj = paths[bag.group_id] || [
      { name: bag.name, level_title: bag.level_title || LEVEL_PRESETS[0] },
    ];
    const cleanParts = partsObj.map((x) => x.name.trim()).filter(Boolean);
    const levelTitles = partsObj.map((x) => x.level_title.trim()).filter(Boolean);
    if (cleanParts.length === 0) {
      setError(t("error_path_required"));
      return;
    }
    setBusy(bag.group_id);
    setError(null);

    const rawTextVal =
      bagRawTexts[bag.group_id] !== undefined
        ? bagRawTexts[bag.group_id]
        : bag.source_raw_text || "";

    const res = await fileBag(bag.group_id, cleanParts, levelTitles, rawTextVal || null);
    if (!res.ok) {
      setBusy(null);
      setError(res.error);
      return;
    }
    setBags((prev) => prev.filter((b) => b.group_id !== bag.group_id));
    await syncFromServer();
    setBusy(null);
  }

  async function handleReExtractBag(bagId: string) {
    const rawTextVal = bagRawTexts[bagId];
    if (!rawTextVal || !rawTextVal.trim()) return;

    setExtractingBags((prev) => ({ ...prev, [bagId]: true }));
    setError(null);

    const fd = new FormData();
    fd.append("description", rawTextVal.trim());

    const extractRes = await extractIngestionAction(fd);
    if (!extractRes.ok) {
      setExtractingBags((prev) => ({ ...prev, [bagId]: false }));
      setError(extractRes.error);
      return;
    }

    const newItems = extractRes.result.items.map((i) => ({
      text: i.text.trim(),
      type: i.type,
      anchor: i.anchor,
      cefr_level: i.cefr,
      pos: i.pos,
    }));

    const updateRes = await updateGroupAction(bagId, {
      items: newItems,
      source_raw_text: rawTextVal.trim(),
    });

    if (!updateRes.ok) {
      setExtractingBags((prev) => ({ ...prev, [bagId]: false }));
      setError(updateRes.error);
      return;
    }

    await syncFromServer();
    setExtractingBags((prev) => ({ ...prev, [bagId]: false }));
  }

  async function handleDiscardBag(groupId: string) {
    if (!confirm(t("discard_confirm"))) return;
    setBusy(groupId);
    setError(null);
    const res = await deleteGroup(groupId);
    if (!res.ok) {
      setBusy(null);
      setError(res.error);
      return;
    }
    setBags((prev) => prev.filter((b) => b.group_id !== groupId));
    await syncFromServer();
    setBusy(null);
  }

  function moveLevel(bagId: string, idx: number, direction: "left" | "right") {
    setPaths((prev) => {
      const arr = [...(prev[bagId] || [])];
      if (arr.length <= 1) return prev;
      const targetIdx = direction === "left" ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= arr.length) return prev;
      const temp = arr[idx];
      arr[idx] = arr[targetIdx];
      arr[targetIdx] = temp;
      return {
        ...prev,
        [bagId]: arr,
      };
    });
  }

  async function fileAllCandidates() {
    const parts = splitPath(candPath);
    if (parts.length === 0) {
      setError(t("error_path_required"));
      return;
    }
    if (candidates.length === 0) return;
    setBusy("candidates");
    setError(null);
    const res = await createGroup({
      name: parts[parts.length - 1],
      kind: "generic",
      tag_path: parts,
      items: candidates.map((c) => ({ text: c.text, type: "word" as const })),
    });
    if (!res.ok) {
      setBusy(null);
      setError(res.error);
      return;
    }
    setCandidates([]);
    setCandPath("");
    await syncFromServer();
    setBusy(null);
  }

  if (initialInbox.learner_id === null) {
    return <EmptyState className="p-8">{t("no_learner_hint")}</EmptyState>;
  }

  const nothingLeft = bags.length === 0 && candidates.length === 0;

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive" className="px-3">
          {t("action_failed", { error })}
        </Alert>
      )}

      {existingPaths.length > 0 && (
        <details className="border-border bg-card/40 rounded-lg border px-3 py-2 text-xs">
          <summary className="text-muted-foreground cursor-pointer select-none">
            {t("existing_structure", { count: existingPaths.length })}
          </summary>
          <ul className="text-muted-foreground mt-2 space-y-0.5">
            {existingPaths.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </details>
      )}

      {nothingLeft && <EmptyState className="p-10">{t("inbox_empty")}</EmptyState>}

      {/* ── Capture bags — one card per ingest, filed as a whole ─────────── */}
      {bags.map((bag) => {
        const isBusy = busy === bag.group_id;
        const isSuggesting = suggesting[bag.group_id];
        const preview = bag.items.slice(0, 14);
        return (
          <section
            key={bag.group_id}
            className="border-border bg-card space-y-3 rounded-xl border p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                <FolderInput className="text-primary h-4 w-4" />
                {bag.name}
                <span className="text-muted-foreground font-normal">
                  · {t("word_count", { count: bag.items.length })}
                </span>
              </h3>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {preview.map((it) => (
                <span
                  key={it.id}
                  className="border-border bg-background inline-flex rounded-full border px-2.5 py-0.5 text-xs"
                >
                  {it.text}
                </span>
              ))}
              {bag.items.length > preview.length && (
                <span className="text-muted-foreground px-1 text-xs">
                  +{bag.items.length - preview.length}
                </span>
              )}
            </div>

            <div className="space-y-3">
              <label className="text-muted-foreground flex items-center gap-1 pl-1 text-[11px] font-medium">
                <Wand2 className="text-primary h-3 w-3" />
                {t("path_editor_label")}
              </label>

              {/* Multi-segment pill editor — capsule-style visual hierarchy editing */}
              <div
                className={cn(
                  "border-primary/10 bg-primary/5 flex flex-wrap items-center gap-x-2 gap-y-3 rounded-xl border p-4",
                  isSuggesting && "animate-pulse",
                )}
              >
                {(
                  paths[bag.group_id] || [
                    { name: bag.name, level_title: bag.level_title || LEVEL_PRESETS[0] },
                  ]
                ).map((lvl, idx) => (
                  <div key={idx} className="flex items-center gap-1.5">
                    {idx > 0 && (
                      <span className="text-muted-foreground px-0.5 font-semibold">›</span>
                    )}
                    <div className="border-border bg-card focus-within:ring-ring relative flex min-w-[150px] flex-col rounded-lg border p-2 shadow-sm focus-within:ring-1">
                      {/* Level Title Segment Input */}
                      <div className="group/level relative mb-1.5">
                        <Popover
                          open={
                            activeLevelTitlePopover?.bagId === bag.group_id &&
                            activeLevelTitlePopover?.idx === idx
                          }
                          onOpenChange={(open) =>
                            setActiveLevelTitlePopover(open ? { bagId: bag.group_id, idx } : null)
                          }
                        >
                          {/* The div acts as trigger/anchor; the input uses stopPropagation
                              to block the toggle, and onFocus controls the open state manually
                              to avoid click flicker. */}
                          <PopoverTrigger render={<div className="w-full" />}>
                            <input
                              type="text"
                              value={lvl.level_title}
                              onChange={(e) => {
                                const val = e.target.value;
                                setPaths((prev) => {
                                  const arr = [...(prev[bag.group_id] || [])];
                                  arr[idx] = { ...arr[idx], level_title: val };
                                  return { ...prev, [bag.group_id]: arr };
                                });
                                setActiveLevelTitlePopover({ bagId: bag.group_id, idx });
                              }}
                              onFocus={() =>
                                setActiveLevelTitlePopover({ bagId: bag.group_id, idx })
                              }
                              onClick={(e) => e.stopPropagation()}
                              onPointerDown={(e) => e.stopPropagation()}
                              disabled={isBusy}
                              placeholder={t("level_title_placeholder")}
                              className="border-primary/20 bg-primary/5 text-primary hover:border-primary/30 focus:border-primary/30 focus:bg-background w-full rounded border py-0.5 pr-6 pl-1.5 text-[9px] font-bold tracking-wide uppercase transition duration-150 outline-none select-all focus:ring-0"
                            />
                          </PopoverTrigger>
                          <PopoverContent
                            align="start"
                            className="border-border bg-popover z-50 max-h-60 w-40 overflow-y-auto rounded-xl border p-1 shadow-xl focus:outline-none"
                          >
                            <div className="text-muted-foreground/70 mb-1 border-b px-2 py-1 text-[9px] font-bold tracking-wider uppercase">
                              {t("level_presets_header")}
                            </div>
                            <div className="space-y-0.5">
                              {LEVEL_PRESETS.filter((opt) =>
                                opt.includes(lvl.level_title || ""),
                              ).map((opt) => (
                                <button
                                  key={opt}
                                  type="button"
                                  onClick={() => {
                                    setPaths((prev) => {
                                      const arr = [...(prev[bag.group_id] || [])];
                                      arr[idx] = { ...arr[idx], level_title: opt };
                                      return { ...prev, [bag.group_id]: arr };
                                    });
                                    setActiveLevelTitlePopover(null);
                                  }}
                                  className="hover:bg-primary/5 hover:text-primary flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition"
                                >
                                  {opt}
                                </button>
                              ))}
                            </div>
                          </PopoverContent>
                        </Popover>
                        <Edit3 className="text-primary/60 group-focus-within/level:text-primary pointer-events-none absolute top-1/2 right-1 h-2 w-2 -translate-y-1/2 opacity-60 transition" />
                      </div>

                      {/* Tag Name Segment Input with Popover Autocomplete */}
                      <div className="group/value-title relative flex items-center gap-1">
                        <Popover
                          open={activePopover?.bagId === bag.group_id && activePopover?.idx === idx}
                          onOpenChange={(open) =>
                            setActivePopover(open ? { bagId: bag.group_id, idx } : null)
                          }
                        >
                          {/* The div acts as trigger/anchor; the input uses stopPropagation
                              to block the toggle. */}
                          <PopoverTrigger render={<div className="w-full" />}>
                            <input
                              type="text"
                              value={lvl.name}
                              onChange={(e) => {
                                const val = e.target.value;
                                setPaths((prev) => {
                                  const arr = [...(prev[bag.group_id] || [])];
                                  arr[idx] = { ...arr[idx], name: val };
                                  return { ...prev, [bag.group_id]: arr };
                                });
                                setActivePopover({ bagId: bag.group_id, idx });
                              }}
                              onFocus={() => setActivePopover({ bagId: bag.group_id, idx })}
                              onClick={(e) => e.stopPropagation()}
                              onPointerDown={(e) => e.stopPropagation()}
                              disabled={isBusy}
                              placeholder={
                                isSuggesting ? t("suggesting_placeholder") : t("none_placeholder")
                              }
                              className="text-foreground border-border bg-muted/30 hover:border-input focus:border-primary/30 focus:bg-background w-full rounded border py-0.5 pr-8 pl-1.5 text-xs font-semibold transition outline-none focus:ring-0"
                            />
                          </PopoverTrigger>
                          <PopoverContent
                            align="start"
                            className="border-border bg-popover z-50 max-h-60 w-64 overflow-y-auto rounded-xl border p-1 shadow-xl focus:outline-none"
                          >
                            <div className="text-muted-foreground/70 mb-1 border-b px-2.5 py-1 text-[9px] font-bold tracking-wider uppercase">
                              {t("autocomplete_header")}
                            </div>
                            {(() => {
                              // Cache result to avoid traversing the group tree twice.
                              const opts = getAutocompleteOptions(bag.group_id, idx).filter((opt) =>
                                opt.toLowerCase().includes(lvl.name.toLowerCase()),
                              );
                              return opts.length === 0 ? (
                                <div className="text-muted-foreground px-3 py-2.5 text-xs italic">
                                  {t("autocomplete_empty")}
                                </div>
                              ) : (
                                <div className="space-y-0.5">
                                  {opts.map((opt) => (
                                    <button
                                      key={opt}
                                      type="button"
                                      onClick={() => {
                                        setPaths((prev) => {
                                          const arr = [...(prev[bag.group_id] || [])];
                                          arr[idx] = { ...arr[idx], name: opt };
                                          return { ...prev, [bag.group_id]: arr };
                                        });
                                        setActivePopover(null);
                                      }}
                                      className="hover:bg-muted/50 hover:text-primary flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition"
                                    >
                                      <span>{opt}</span>
                                      <span className="py-0.2 border-success/30 bg-success/10 text-success shrink-0 rounded border px-1 text-[9px] font-semibold">
                                        {t("existing_badge")}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              );
                            })()}
                          </PopoverContent>
                        </Popover>
                        <Edit3 className="text-muted-foreground/70 group-focus-within/value-title:text-primary pointer-events-none absolute top-1/2 right-6 h-2.5 w-2.5 -translate-y-1/2 transition" />
                        <div className="ml-1 flex shrink-0 items-center gap-0.5">
                          {idx > 0 && !isBusy && (
                            <button
                              type="button"
                              onClick={() => moveLevel(bag.group_id, idx, "left")}
                              className="text-muted-foreground/40 hover:text-primary p-0.5 transition"
                              title={t("move_left")}
                            >
                              <ArrowLeft className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {idx < (paths[bag.group_id] || []).length - 1 && !isBusy && (
                            <button
                              type="button"
                              onClick={() => moveLevel(bag.group_id, idx, "right")}
                              className="text-muted-foreground/40 hover:text-primary p-0.5 transition"
                              title={t("move_right")}
                            >
                              <ArrowRight className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {(paths[bag.group_id] || []).length > 1 && !isBusy && (
                            <button
                              type="button"
                              onClick={() => {
                                setPaths((prev) => ({
                                  ...prev,
                                  [bag.group_id]: (prev[bag.group_id] || []).filter(
                                    (_, i) => i !== idx,
                                  ),
                                }));
                              }}
                              className="text-muted-foreground/40 hover:text-destructive shrink-0 p-0.5 transition"
                              title={t("remove_level")}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

                {!isBusy && (
                  <button
                    type="button"
                    onClick={() => {
                      setPaths((prev) => {
                        const current = prev[bag.group_id] || [];
                        const nextIdx = current.length;
                        return {
                          ...prev,
                          [bag.group_id]: [
                            ...current,
                            {
                              name: "",
                              level_title:
                                LEVEL_PRESETS[nextIdx] || t("level_fallback", { n: nextIdx + 1 }),
                            },
                          ],
                        };
                      });
                    }}
                    className="border-primary/20 text-primary hover:bg-primary/5 flex h-[46px] items-center justify-center rounded-lg border border-dashed px-3 text-xs font-semibold shadow-sm transition"
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    {t("add_level")}
                  </button>
                )}
              </div>

              {/* Confirm / Discard actions */}
              <div className="flex flex-col gap-2 pt-1 sm:flex-row">
                <Button
                  type="button"
                  onClick={() => doFileBag(bag)}
                  disabled={isBusy || isSuggesting || extractingBags[bag.group_id]}
                  className="w-full shrink-0 sm:w-auto"
                >
                  {isBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <FolderInput className="h-4 w-4" />
                  )}
                  {t("file_bag")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleDiscardBag(bag.group_id)}
                  disabled={isBusy || isSuggesting || extractingBags[bag.group_id]}
                  className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive w-full shrink-0 sm:w-auto"
                >
                  {t("discard_bag")}
                </Button>
              </div>

              {/* Tap to reuse an existing path — avoids typing on mobile. */}
              {existingPaths.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-muted-foreground text-[11px]">{t("reuse_existing")}</span>
                  {existingPaths.slice(0, 6).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() =>
                        setPaths((prev) => ({
                          ...prev,
                          [bag.group_id]: p.split(" › ").map((val, i) => ({
                            name: val,
                            level_title: LEVEL_PRESETS[i] || t("level_fallback", { n: i + 1 }),
                          })),
                        }))
                      }
                      className="border-border bg-background text-muted-foreground hover:border-primary/30 hover:text-primary rounded-full border px-2.5 py-1 text-[11px] transition"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              )}

              {/* Draft tweak & re-analysis (start with vision, refine with text) */}
              <details className="group border-border bg-muted/30 open:border-input open:bg-muted/50 rounded-lg border p-3 transition-all duration-200">
                <summary className="text-foreground/80 flex cursor-pointer items-center justify-between text-[10px] font-bold tracking-wider uppercase outline-none select-none">
                  <span className="flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5" />
                    {t("raw_draft_title")}
                  </span>
                  <span className="text-muted-foreground text-[9px] font-normal group-open:hidden">
                    {t("raw_draft_expand_hint")}
                  </span>
                </summary>
                <div className="mt-2 space-y-2">
                  <textarea
                    value={bagRawTexts[bag.group_id] || ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      setBagRawTexts((prev) => ({ ...prev, [bag.group_id]: val }));
                    }}
                    placeholder={t("raw_draft_placeholder")}
                    rows={4}
                    className="bg-background border-border focus:ring-ring w-full resize-y rounded-lg border p-2.5 font-mono text-xs leading-relaxed outline-none focus:ring-1"
                  />
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={
                        !(bagRawTexts[bag.group_id] || "").trim() || extractingBags[bag.group_id]
                      }
                      onClick={() => handleReExtractBag(bag.group_id)}
                      className="border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 h-7 gap-1.5 border text-xs font-medium transition-all active:scale-[0.98]"
                    >
                      {extractingBags[bag.group_id] && <Loader2 className="h-3 w-3 animate-spin" />}
                      {t("re_extract")}
                    </Button>
                  </div>
                </div>
              </details>
            </div>
          </section>
        );
      })}

      {/* ── Practice-derived candidates — filed in bulk into one path ────── */}
      {candidates.length > 0 && (
        <section className="border-border bg-card border-warning/40 space-y-3 rounded-xl border p-4">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <Sparkles className="text-warning h-4 w-4" />
            {t("candidates_title")}
            <span className="text-muted-foreground font-normal">
              · {t("candidates_count", { count: candidates.length })}
            </span>
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {candidates.slice(0, 30).map((c) => (
              <span
                key={c.text}
                className="border-warning/40 bg-warning/10 text-warning inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs"
              >
                {c.text}
                <span className="text-[10px] opacity-60">×{c.count}</span>
              </span>
            ))}
            {candidates.length > 30 && (
              <span className="text-muted-foreground px-1 text-xs">+{candidates.length - 30}</span>
            )}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={candPath}
              onChange={(e) => setCandPath(e.target.value)}
              disabled={busy === "candidates"}
              placeholder={t("candidates_path_placeholder")}
              className="bg-background border-border focus:ring-warning min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1 disabled:opacity-50"
            />
            <Button
              type="button"
              variant="outline"
              onClick={fileAllCandidates}
              disabled={busy === "candidates" || !candPath.trim()}
              className="w-full shrink-0 sm:w-auto"
            >
              {busy === "candidates" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FolderInput className="h-4 w-4" />
              )}
              {t("file_all")}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
