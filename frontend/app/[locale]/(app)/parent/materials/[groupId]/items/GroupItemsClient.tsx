"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, BookOpen, Loader2, Plus, Save, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { GroupDetailOut, ItemType, LanguageItemOut } from "@/lib/backend";
import { updateGroup } from "../../actions";

interface Props {
  group: GroupDetailOut;
}

const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

export function GroupItemsClient({ group }: Props) {
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
      setSuccessMsg("重点词句保存成功！");
      router.refresh();
      setTimeout(() => setSuccessMsg(null), 3000);
    } else {
      setErrorMsg(`保存失败: ${res.error}`);
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
        <div className="border-destructive/20 bg-destructive/10 text-destructive rounded-lg border p-3 text-sm">
          {errorMsg}
        </div>
      )}
      {successMsg && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-600">
          {successMsg}
        </div>
      )}

      {/* Floating Sticky Toolbar */}
      <div className="border-border/80 bg-background/90 sticky top-14 z-10 flex flex-col justify-between gap-3 rounded-xl border p-4 shadow-md backdrop-blur-md sm:flex-row sm:items-center sm:gap-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40">
            <BookOpen className="h-5 w-5 animate-pulse" />
          </div>
          <div>
            <span className="text-foreground block text-sm leading-tight font-bold">
              重点学习点词表管理
            </span>
            <span className="text-muted-foreground text-[11px]">
              当前共包含 {items.length} 个学习词句
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
            返回教材信息
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            size="sm"
            className="flex-1 bg-indigo-600 text-white hover:bg-indigo-700 sm:flex-none"
          >
            {saving ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-4 w-4" />
            )}
            保存所有修改
          </Button>
        </div>
      </div>

      {/* Main Spacious Cards Editor */}
      <div className="space-y-6">
        {/* Section: Words */}
        <div className="border-border/80 bg-card space-y-4 rounded-xl border p-6 shadow-sm">
          <div className="flex items-center justify-between border-b pb-3">
            <div>
              <h3 className="text-foreground text-base font-bold">1. 单词列表 (Words)</h3>
              <p className="text-muted-foreground text-xs">
                录入本次课程需要掌握的英文核心生词，AI 在对话中会重点考察并辅助孩子造句。
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => addItem("word")}>
              <Plus className="mr-1.5 h-4 w-4 text-indigo-600" />
              添加单词
            </Button>
          </div>

          <div className="space-y-2">
            {itemsByType.word.length === 0 ? (
              <div className="rounded-lg border border-dashed bg-slate-50/50 py-8 text-center dark:bg-slate-900/10">
                <p className="text-muted-foreground text-sm italic">暂无单词学习点</p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 text-indigo-600 hover:text-indigo-700"
                  onClick={() => addItem("word")}
                >
                  + 立即添加第一个单词
                </Button>
              </div>
            ) : (
              <div className="max-h-[500px] space-y-2 divide-y overflow-y-auto pr-2">
                {itemsByType.word.map(({ item, originalIndex }) => (
                  <div
                    key={originalIndex}
                    className="flex flex-col gap-3 py-3 last:border-0 sm:flex-row sm:items-center sm:py-2"
                  >
                    <input
                      type="text"
                      value={item.text}
                      onChange={(e) => updateItem(originalIndex, { text: e.target.value })}
                      placeholder="输入英文单词 (如: yellow)"
                      className="bg-background border-border focus:ring-ring w-full min-w-0 rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1 sm:flex-[3]"
                    />
                    <div className="flex w-full min-w-0 items-center gap-3 sm:w-auto sm:flex-[2]">
                      <input
                        type="text"
                        value={item.pos || ""}
                        onChange={(e) => updateItem(originalIndex, { pos: e.target.value })}
                        placeholder="词性 (如: noun, verb)"
                        className="bg-background border-border focus:ring-ring min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1 sm:w-36"
                      />
                      <select
                        value={item.cefr_level || ""}
                        onChange={(e) =>
                          updateItem(originalIndex, { cefr_level: e.target.value || null })
                        }
                        className="bg-background border-border focus:ring-ring shrink-0 rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1"
                      >
                        <option value="">难度</option>
                        {CEFR_LEVELS.map((lvl) => (
                          <option key={lvl} value={lvl}>
                            {lvl}
                          </option>
                        ))}
                      </select>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeItem(originalIndex)}
                        className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Section: Phrases */}
        <div className="border-border/80 bg-card space-y-4 rounded-xl border p-6 shadow-sm">
          <div className="flex items-center justify-between border-b pb-3">
            <div>
              <h3 className="text-foreground text-base font-bold">2. 短语/固定搭配 (Phrases)</h3>
              <p className="text-muted-foreground text-xs">
                录入常见的固定词组、动词短语等搭配 (如: get up, by the way)。
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => addItem("phrase")}>
              <Plus className="mr-1.5 h-4 w-4 text-indigo-600" />
              添加短语
            </Button>
          </div>

          <div className="space-y-2">
            {itemsByType.phrase.length === 0 ? (
              <div className="rounded-lg border border-dashed bg-slate-50/50 py-8 text-center dark:bg-slate-900/10">
                <p className="text-muted-foreground text-sm italic">暂无短语学习点</p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 text-indigo-600 hover:text-indigo-700"
                  onClick={() => addItem("phrase")}
                >
                  + 立即添加第一个短语
                </Button>
              </div>
            ) : (
              <div className="max-h-[500px] space-y-2 divide-y overflow-y-auto pr-2">
                {itemsByType.phrase.map(({ item, originalIndex }) => (
                  <div
                    key={originalIndex}
                    className="flex flex-col gap-3 py-3 last:border-0 sm:flex-row sm:items-center sm:py-2"
                  >
                    <input
                      type="text"
                      value={item.text}
                      onChange={(e) => updateItem(originalIndex, { text: e.target.value })}
                      placeholder="输入固定短语/搭配 (如: read a book)"
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
                        <option value="">难度</option>
                        {CEFR_LEVELS.map((lvl) => (
                          <option key={lvl} value={lvl}>
                            {lvl}
                          </option>
                        ))}
                      </select>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeItem(originalIndex)}
                        className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Section: Patterns */}
        <div className="border-border/80 bg-card space-y-4 rounded-xl border p-6 shadow-sm">
          <div className="flex items-center justify-between border-b pb-3">
            <div>
              <h3 className="text-foreground text-base font-bold">
                3. 核心句型/语法模板 (Patterns)
              </h3>
              <p className="text-muted-foreground text-xs">
                使用下划线定义句式模板，并提供精确定位锚点以帮助 AI 在孩子口语中匹配句型 (如: I like
                ___.)。
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => addItem("pattern")}>
              <Plus className="mr-1.5 h-4 w-4 text-indigo-600" />
              添加句型
            </Button>
          </div>

          <div className="space-y-2">
            {itemsByType.pattern.length === 0 ? (
              <div className="rounded-lg border border-dashed bg-slate-50/50 py-8 text-center dark:bg-slate-900/10">
                <p className="text-muted-foreground text-sm italic">暂无句型/语法模板</p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 text-indigo-600 hover:text-indigo-700"
                  onClick={() => addItem("pattern")}
                >
                  + 立即添加第一个句型
                </Button>
              </div>
            ) : (
              <div className="max-h-[500px] space-y-4 divide-y overflow-y-auto pr-2">
                {itemsByType.pattern.map(({ item, originalIndex }) => (
                  <div key={originalIndex} className="flex flex-col gap-3 py-4 last:border-0">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <input
                        type="text"
                        value={item.text}
                        onChange={(e) => updateItem(originalIndex, { text: e.target.value })}
                        placeholder="句型模板 (如: I want to ___.)"
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
                          <option value="">难度</option>
                          {CEFR_LEVELS.map((lvl) => (
                            <option key={lvl} value={lvl}>
                              {lvl}
                            </option>
                          ))}
                        </select>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeItem(originalIndex)}
                          className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 rounded-lg bg-slate-50 p-3 sm:flex-row sm:items-center dark:bg-slate-900/30">
                      <span className="text-muted-foreground shrink-0 text-xs font-semibold tracking-wider uppercase">
                        Anchor 定位锚点:
                      </span>
                      <input
                        type="text"
                        value={item.anchor || ""}
                        onChange={(e) => updateItem(originalIndex, { anchor: e.target.value })}
                        placeholder="句型起始段，AI用来做识别匹配 (如: i want to)"
                        className="bg-background border-border focus:ring-ring min-w-0 flex-1 rounded-md border px-3 py-1 text-xs outline-none focus:ring-1"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
