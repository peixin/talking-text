"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, BookOpen, Loader2, Plus, Save, X } from "lucide-react";
import { Link } from "@/i18n/routing";

import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/EmptyState";
import { Panel } from "@/components/Panel";
import type { GroupDetailOut, ItemType, LanguageItemOut } from "@/lib/backend";
import { updateGroup } from "../../actions";

interface Props {
  group: GroupDetailOut;
  readOnly?: boolean;
}

const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

export function GroupItemsClient({ group, readOnly = false }: Props) {
  const t = useTranslations("Materials");
  const router = useRouter();

  // Local state for language items
  const [items, setItems] = useState<Omit<LanguageItemOut, "id">[]>(group.items);

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Handle saving learning items updates
  async function handleSave() {
    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    const formattedItems = items
      .map((it) => ({
        text: it.text.trim(),
        type: it.type,
        anchor: it.anchor ? it.anchor.trim() : null,
        cefr_level: it.cefr_level || null,
        pos: it.pos ? it.pos.trim() : null,
      }))
      .filter((it) => it.text.length > 0);

    // Call existing updateGroup server action, passing only the updated items list
    const res = await updateGroup(group.id, {
      items: formattedItems,
    });

    setSaving(false);
    if (res.ok) {
      setSuccessMsg(t("items_save_success"));
      router.refresh();
      setTimeout(() => setSuccessMsg(null), 3000);
    } else {
      setErrorMsg(t("save_failed", { error: res.error }));
    }
  }

  // Helpers for items CRUD
  function addItem(type: ItemType) {
    setItems((prev) => [
      ...prev,
      {
        type,
        text: "",
        anchor: "",
        cefr_level: null,
        pos: null,
      },
    ]);
  }

  function updateItem(idx: number, patch: Partial<Omit<LanguageItemOut, "id">>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  // Group items by type
  const itemsByType = useMemo(() => {
    const acc: Record<ItemType, { item: Omit<LanguageItemOut, "id">; originalIndex: number }[]> = {
      word: [],
      phrase: [],
      pattern: [],
    };
    items.forEach((item, index) => {
      acc[item.type].push({ item, originalIndex: index });
    });
    return acc;
  }, [items]);

  return (
    <div className="space-y-6">
      {/* Messages */}
      {errorMsg && (
        <Alert variant="destructive" className="border-destructive/20 p-3">
          <AlertDescription>{errorMsg}</AlertDescription>
        </Alert>
      )}
      {successMsg && (
        <Alert variant="success" className="border-success/20 p-3">
          <AlertDescription>{successMsg}</AlertDescription>
        </Alert>
      )}

      {/* Floating Sticky Toolbar */}
      <div className="border-border/80 bg-background/90 sticky top-14 z-10 flex flex-col justify-between gap-3 rounded-xl border p-4 shadow-md backdrop-blur-md sm:flex-row sm:items-center sm:gap-4">
        <div className="flex items-center gap-2.5">
          <div className="bg-primary/10 text-primary flex h-9 w-9 items-center justify-center rounded-lg">
            <BookOpen className="h-5 w-5 animate-pulse" />
          </div>
          <div>
            <span className="text-foreground block text-sm leading-tight font-bold">
              {t("items_toolbar_title")}
            </span>
            <span className="text-muted-foreground text-[11px]">
              {t("items_toolbar_count", { count: items.length })}
            </span>
          </div>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/parent/materials/${group.id}`)}
            disabled={saving}
            className="flex-1 sm:flex-none"
          >
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            {t("back_to_detail")}
          </Button>
          {readOnly ? (
            <Button
              onClick={() => router.push(`/parent/materials/${group.id}/items/edit`)}
              size="sm"
              className="bg-primary text-primary-foreground hover:bg-primary/90 flex flex-1 items-center justify-center sm:flex-none"
            >
              <Plus className="mr-1.5 h-4 w-4" />
              {t("edit_items_button")}
            </Button>
          ) : (
            <Button
              onClick={handleSave}
              disabled={saving}
              size="sm"
              className="bg-primary text-primary-foreground hover:bg-primary/90 flex-1 sm:flex-none"
            >
              {saving ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-1.5 h-4 w-4" />
              )}
              {t("save_all_changes")}
            </Button>
          )}
        </div>
      </div>

      {/* Main Spacious Cards Editor */}
      <div className="space-y-6">
        {/* Section: Words */}
        <Panel className="border-border/80 space-y-4 p-6 shadow-sm">
          <div className="flex items-center justify-between border-b pb-3">
            <div>
              <h3 className="text-foreground text-base font-bold">{t("words_section_title")}</h3>
              <p className="text-muted-foreground text-xs">{t("words_section_hint")}</p>
            </div>
            {!readOnly && (
              <Button variant="outline" size="sm" onClick={() => addItem("word")}>
                <Plus className="text-primary mr-1.5 h-4 w-4" />
                {t("add_word")}
              </Button>
            )}
          </div>

          <div className="space-y-2">
            {itemsByType.word.length === 0 ? (
              <EmptyState
                className="bg-muted/30 rounded-lg py-8"
                action={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-primary hover:text-primary/80 -mt-2"
                    onClick={() => addItem("word")}
                  >
                    {t("add_first_word")}
                  </Button>
                }
              >
                <span className="italic">{t("no_words")}</span>
              </EmptyState>
            ) : (
              <div className="max-h-[500px] space-y-2 divide-y overflow-y-auto pr-2">
                {itemsByType.word.map(({ item, originalIndex }) => (
                  <div
                    key={originalIndex}
                    className="flex flex-col gap-3 py-3 last:border-0 sm:flex-row sm:items-center sm:py-2"
                  >
                    {readOnly ? (
                      <div className="flex flex-1 items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-foreground text-sm font-semibold select-all">
                            {item.text || "—"}
                          </span>
                          {item.source_group_name && (
                            <Link
                              href={`/parent/materials/${item.source_group_id}/items/edit`}
                              className="border-primary/10 bg-primary/5 text-primary hover:bg-primary/10 rounded border px-1.5 py-0.5 text-[9px] font-medium"
                              title={t("edit_source_item_tooltip")}
                            >
                              {t("from_source", { name: item.source_group_name })}
                            </Link>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {item.pos && (
                            <Badge
                              variant="outline"
                              className="border-primary/20 bg-primary/5 text-primary h-auto rounded px-2 py-0.5 text-[10px] font-semibold"
                            >
                              {item.pos}
                            </Badge>
                          )}
                          {item.cefr_level && (
                            <Badge
                              variant="success"
                              className="border-success/30 h-auto rounded px-2 py-0.5 text-[10px] font-semibold"
                            >
                              {item.cefr_level}
                            </Badge>
                          )}
                        </div>
                      </div>
                    ) : (
                      <>
                        <input
                          type="text"
                          value={item.text}
                          onChange={(e) => updateItem(originalIndex, { text: e.target.value })}
                          placeholder={t("word_placeholder")}
                          className="bg-background border-border focus:ring-ring w-full min-w-0 rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1 sm:flex-[3]"
                        />
                        <div className="flex w-full min-w-0 items-center gap-3 sm:w-auto sm:flex-[2]">
                          <input
                            type="text"
                            value={item.pos || ""}
                            onChange={(e) => updateItem(originalIndex, { pos: e.target.value })}
                            placeholder={t("pos_placeholder")}
                            className="bg-background border-border focus:ring-ring min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1 sm:w-36"
                          />
                          <select
                            value={item.cefr_level || ""}
                            onChange={(e) =>
                              updateItem(originalIndex, { cefr_level: e.target.value || null })
                            }
                            className="bg-background border-border focus:ring-ring shrink-0 rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1"
                          >
                            <option value="">{t("difficulty")}</option>
                            {CEFR_LEVELS.map((lvl) => (
                              <option key={lvl} value={lvl}>
                                {lvl}
                              </option>
                            ))}
                          </select>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeItem(originalIndex)}
                            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Panel>

        {/* Section: Phrases */}
        <Panel className="border-border/80 space-y-4 p-6 shadow-sm">
          <div className="flex items-center justify-between border-b pb-3">
            <div>
              <h3 className="text-foreground text-base font-bold">{t("phrases_section_title")}</h3>
              <p className="text-muted-foreground text-xs">{t("phrases_section_hint")}</p>
            </div>
            {!readOnly && (
              <Button variant="outline" size="sm" onClick={() => addItem("phrase")}>
                <Plus className="text-primary mr-1.5 h-4 w-4" />
                {t("add_phrase")}
              </Button>
            )}
          </div>

          <div className="space-y-2">
            {itemsByType.phrase.length === 0 ? (
              <EmptyState
                className="bg-muted/30 rounded-lg py-8"
                action={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-primary hover:text-primary/80 -mt-2"
                    onClick={() => addItem("phrase")}
                  >
                    {t("add_first_phrase")}
                  </Button>
                }
              >
                <span className="italic">{t("no_phrases")}</span>
              </EmptyState>
            ) : (
              <div className="max-h-[500px] space-y-2 divide-y overflow-y-auto pr-2">
                {itemsByType.phrase.map(({ item, originalIndex }) => (
                  <div
                    key={originalIndex}
                    className="flex flex-col gap-3 py-3 last:border-0 sm:flex-row sm:items-center sm:py-2"
                  >
                    {readOnly ? (
                      <div className="flex flex-1 items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-foreground text-sm font-semibold select-all">
                            {item.text || "—"}
                          </span>
                          {item.source_group_name && (
                            <Link
                              href={`/parent/materials/${item.source_group_id}/items/edit`}
                              className="border-primary/10 bg-primary/5 text-primary hover:bg-primary/10 rounded border px-1.5 py-0.5 text-[9px] font-medium"
                              title={t("edit_source_item_tooltip")}
                            >
                              {t("from_source", { name: item.source_group_name })}
                            </Link>
                          )}
                        </div>
                        {item.cefr_level && (
                          <Badge
                            variant="success"
                            className="border-success/30 h-auto rounded px-2 py-0.5 text-[10px] font-semibold"
                          >
                            {item.cefr_level}
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <>
                        <input
                          type="text"
                          value={item.text}
                          onChange={(e) => updateItem(originalIndex, { text: e.target.value })}
                          placeholder={t("phrase_placeholder")}
                          className="bg-background border-border focus:ring-ring w-full min-w-0 rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1 sm:flex-[4]"
                        />
                        <div className="flex w-full items-center gap-3 sm:w-auto">
                          <select
                            value={item.cefr_level || ""}
                            onChange={(e) =>
                              updateItem(originalIndex, { cefr_level: e.target.value || null })
                            }
                            className="bg-background border-border focus:ring-ring flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1 sm:flex-none"
                          >
                            <option value="">{t("difficulty")}</option>
                            {CEFR_LEVELS.map((lvl) => (
                              <option key={lvl} value={lvl}>
                                {lvl}
                              </option>
                            ))}
                          </select>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeItem(originalIndex)}
                            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Panel>

        {/* Section: Patterns */}
        <Panel className="border-border/80 space-y-4 p-6 shadow-sm">
          <div className="flex items-center justify-between border-b pb-3">
            <div>
              <h3 className="text-foreground text-base font-bold">{t("patterns_section_title")}</h3>
              <p className="text-muted-foreground text-xs">{t("patterns_section_hint")}</p>
            </div>
            {!readOnly && (
              <Button variant="outline" size="sm" onClick={() => addItem("pattern")}>
                <Plus className="text-primary mr-1.5 h-4 w-4" />
                {t("add_pattern")}
              </Button>
            )}
          </div>

          <div className="space-y-2">
            {itemsByType.pattern.length === 0 ? (
              <EmptyState
                className="bg-muted/30 rounded-lg py-8"
                action={
                  !readOnly && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-primary hover:text-primary/80 -mt-2"
                      onClick={() => addItem("pattern")}
                    >
                      {t("add_first_pattern")}
                    </Button>
                  )
                }
              >
                <span className="italic">{t("no_patterns")}</span>
              </EmptyState>
            ) : (
              <div className="max-h-[500px] space-y-4 divide-y overflow-y-auto pr-2">
                {itemsByType.pattern.map(({ item, originalIndex }) => (
                  <div key={originalIndex} className="flex flex-col gap-3 py-4 last:border-0">
                    {readOnly ? (
                      <div className="flex-1 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-foreground text-sm font-semibold select-all">
                              {item.text || "—"}
                            </span>
                            {item.source_group_name && (
                              <Link
                                href={`/parent/materials/${item.source_group_id}/items/edit`}
                                className="border-primary/10 bg-primary/5 text-primary hover:bg-primary/10 rounded border px-1.5 py-0.5 text-[9px] font-medium"
                                title={t("edit_source_item_tooltip")}
                              >
                                {t("from_source", { name: item.source_group_name })}
                              </Link>
                            )}
                          </div>
                          {item.cefr_level && (
                            <Badge
                              variant="success"
                              className="border-success/30 h-auto rounded px-2 py-0.5 text-[10px] font-semibold"
                            >
                              {item.cefr_level}
                            </Badge>
                          )}
                        </div>
                        {item.anchor && (
                          <div className="bg-muted/50 text-foreground/80 flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs">
                            <span className="text-muted-foreground text-[10px] font-bold uppercase">
                              {t("anchor_label")}
                            </span>
                            <span className="font-mono text-xs select-all">{item.anchor}</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                          <input
                            type="text"
                            value={item.text}
                            onChange={(e) => updateItem(originalIndex, { text: e.target.value })}
                            placeholder={t("pattern_placeholder")}
                            className="bg-background border-border focus:ring-ring w-full min-w-0 rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1 sm:flex-[4]"
                          />
                          <div className="flex w-full items-center gap-3 sm:w-auto">
                            <select
                              value={item.cefr_level || ""}
                              onChange={(e) =>
                                updateItem(originalIndex, { cefr_level: e.target.value || null })
                              }
                              className="bg-background border-border focus:ring-ring flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1 sm:flex-none"
                            >
                              <option value="">{t("difficulty")}</option>
                              {CEFR_LEVELS.map((lvl) => (
                                <option key={lvl} value={lvl}>
                                  {lvl}
                                </option>
                              ))}
                            </select>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeItem(originalIndex)}
                              className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        <div className="bg-muted/50 flex flex-col gap-2 rounded-lg p-3 sm:flex-row sm:items-center">
                          <span className="text-muted-foreground shrink-0 text-xs font-semibold tracking-wider uppercase">
                            {t("anchor_label")}
                          </span>
                          <input
                            type="text"
                            value={item.anchor || ""}
                            onChange={(e) => updateItem(originalIndex, { anchor: e.target.value })}
                            placeholder={t("anchor_placeholder")}
                            className="bg-background border-border focus:ring-ring min-w-0 flex-1 rounded-md border px-3 py-1 text-xs outline-none focus:ring-1"
                          />
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
