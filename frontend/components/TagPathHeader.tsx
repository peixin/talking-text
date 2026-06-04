"use client";

import { useMemo } from "react";
import { Link } from "@/i18n/routing";
import { ArrowUpRight, Bookmark, BookOpen, ChevronDown, Sparkles, Zap } from "lucide-react";
import type { GroupOut } from "@/lib/backend";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { LEVEL_PRESETS } from "@/lib/constants";

interface TagPathHeaderProps {
  groupId: string;
  groupName: string;
  groupKind: string;
  allGroups: GroupOut[];
  subtitle?: React.ReactNode;
}

const KIND_LABEL: Record<string, string> = {
  textbook_book: "教材",
  textbook_unit: "单元",
  textbook_lesson: "课次",
  personal_collection: "生词本",
  quick_practice: "随手练习",
  review_set: "复习集",
};

const KIND_ICON: Record<string, typeof BookOpen> = {
  textbook_book: BookOpen,
  textbook_unit: Sparkles,
  textbook_lesson: Zap,
  personal_collection: Bookmark,
  quick_practice: Zap,
  review_set: Bookmark,
};

export function TagPathHeader({
  groupId,
  groupName,
  groupKind,
  allGroups,
  subtitle,
}: TagPathHeaderProps) {
  // The REAL ancestor chain (root → current). We never fabricate path segments.
  const breadcrumbPath = useMemo(() => {
    const nodes: GroupOut[] = [];
    const visited = new Set<string>();
    let curr = allGroups.find((g) => g.id === groupId);
    while (curr) {
      if (visited.has(curr.id)) break;
      visited.add(curr.id);
      nodes.unshift(curr);
      const pid = curr.parent_id;
      if (!pid) break;
      curr = allGroups.find((g) => g.id === pid);
    }
    return nodes;
  }, [groupId, allGroups]);

  // Full chain: ancestors + current, then auto-extend DOWN the branch while each level
  // has exactly one child (real, clickable downstream crumbs). Stop at the first fork
  // and surface its children via a popover — never pick an arbitrary branch. All data
  // is already client-side, so this is pure in-memory traversal (zero extra requests).
  const fullChain = useMemo(() => {
    const crumbs = breadcrumbPath.length > 0 ? [...breadcrumbPath] : [];
    const currentIdx = crumbs.length - 1;
    const guard = new Set(crumbs.map((c) => c.id));
    let cursor: GroupOut | undefined = crumbs[currentIdx];
    let branchChildren: GroupOut[] | null = null;
    while (cursor) {
      const kids = allGroups.filter((g) => g.parent_id === cursor!.id && !g.archived);
      if (kids.length === 0) break;
      if (kids.length > 1) {
        branchChildren = kids;
        break;
      }
      const only = kids[0];
      if (guard.has(only.id)) break;
      guard.add(only.id);
      crumbs.push(only);
      cursor = only;
    }
    return { crumbs, currentIdx, branchChildren };
  }, [breadcrumbPath, allGroups]);

  // Total depth of the whole hierarchy this node belongs to (root → deepest leaf).
  const totalDepth = useMemo(() => {
    const root = breadcrumbPath[0];
    if (!root) return 1;
    const childrenMap = new Map<string, GroupOut[]>();
    allGroups.forEach((g) => {
      if (g.parent_id && !g.archived) {
        const list = childrenMap.get(g.parent_id) || [];
        list.push(g);
        childrenMap.set(g.parent_id, list);
      }
    });
    function maxDepth(id: string, visited: Set<string>): number {
      if (visited.has(id)) return 0;
      visited.add(id);
      const kids = childrenMap.get(id) || [];
      if (kids.length === 0) return 1;
      return 1 + Math.max(...kids.map((k) => maxDepth(k.id, new Set(visited))));
    }
    return maxDepth(root.id, new Set());
  }, [breadcrumbPath, allGroups]);

  return (
    <div className="mb-6 flex flex-col gap-3">
      {/* Full-chain breadcrumb — ancestors + current + auto-extended downstream crumbs,
          a branch popover where it forks, and a total-depth badge. */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-3 rounded-2xl border border-slate-100 bg-slate-50/50 p-4 shadow-sm dark:border-slate-800/40 dark:bg-slate-950/20">
        {fullChain.crumbs.length === 0 ? (
          <div className="relative flex items-center gap-2 rounded-lg border border-indigo-500 bg-indigo-50/70 px-3.5 py-1.5 shadow-sm ring-2 ring-indigo-500/10 dark:bg-indigo-950/40">
            <span className="text-sm leading-none font-bold text-indigo-950 dark:text-white">
              {groupName || "未分类"}
            </span>
          </div>
        ) : (
          fullChain.crumbs.map((node, idx) => {
            const title = node.level_title || LEVEL_PRESETS[idx] || `层级 ${idx + 1}`;
            const isCurrent = idx === fullChain.currentIdx;
            const isAncestor = idx < fullChain.currentIdx;

            const crumb = (
              <div
                className={cn(
                  "relative flex items-center gap-2 rounded-lg border px-3.5 py-1.5 shadow-sm transition-all duration-200",
                  isCurrent &&
                    "border-indigo-500 bg-indigo-50/70 ring-2 ring-indigo-500/10 dark:bg-indigo-950/40",
                  isAncestor &&
                    "group cursor-pointer border-slate-100 bg-white hover:border-indigo-300 hover:bg-indigo-50/30 hover:shadow dark:border-slate-800/40 dark:bg-slate-950/20",
                  !isCurrent &&
                    !isAncestor &&
                    "group cursor-pointer border-dashed border-indigo-200 bg-indigo-50/10 hover:border-indigo-300 hover:bg-indigo-50/30 dark:border-indigo-900/50 dark:bg-indigo-950/10",
                )}
              >
                <div className="flex flex-col items-start leading-none">
                  <span
                    className={cn(
                      "mb-1 flex items-center gap-1 text-[10px] leading-none font-bold tracking-wide uppercase transition-colors",
                      isCurrent
                        ? "text-indigo-600 dark:text-indigo-400"
                        : isAncestor
                          ? "text-indigo-500 group-hover:text-indigo-600"
                          : "text-indigo-400/80 group-hover:text-indigo-600",
                    )}
                  >
                    {title}
                    {isCurrent && (
                      <span className="rounded-sm bg-indigo-600 px-1 py-px text-[8px] leading-none font-bold tracking-normal text-white normal-case">
                        当前
                      </span>
                    )}
                  </span>
                  <span
                    className={cn(
                      "text-sm leading-none font-bold transition-colors",
                      isCurrent
                        ? "text-indigo-950 dark:text-white"
                        : isAncestor
                          ? "text-slate-800 group-hover:text-indigo-600 dark:text-slate-200"
                          : "text-slate-500 group-hover:text-indigo-700 dark:text-slate-400",
                    )}
                  >
                    {node.name || "无"}
                  </span>
                </div>
              </div>
            );

            return (
              <div key={node.id} className="flex items-center gap-1">
                {idx > 0 && (
                  <span className="px-0.5 text-sm font-extrabold text-slate-300 dark:text-slate-700">
                    ›
                  </span>
                )}
                {isCurrent ? crumb : <Link href={`/parent/materials/${node.id}`}>{crumb}</Link>}
              </div>
            );
          })
        )}

        {/* Branch point: fork → list children in a popover instead of picking one. */}
        {fullChain.branchChildren && (
          <div className="flex items-center gap-1">
            <span className="px-0.5 text-sm font-extrabold text-slate-300 dark:text-slate-700">
              ›
            </span>
            <Popover>
              <PopoverTrigger className="flex items-center gap-1.5 rounded-lg border border-dashed border-indigo-300 bg-indigo-50/20 px-3 py-1.5 text-[11px] font-bold text-indigo-600 transition-all hover:border-indigo-400 hover:bg-indigo-100/30 hover:text-indigo-800">
                <ChevronDown className="h-3.5 w-3.5" />含 {fullChain.branchChildren.length} 个下级
              </PopoverTrigger>
              <PopoverContent align="start" className="w-64 gap-1 p-1.5">
                <div className="px-2 py-1 text-[9px] font-bold tracking-wider text-slate-400 uppercase">
                  下级章节（{fullChain.branchChildren.length}）
                </div>
                <div className="max-h-64 space-y-0.5 overflow-y-auto">
                  {fullChain.branchChildren.map((child) => {
                    const ChildIcon = KIND_ICON[child.kind] ?? Bookmark;
                    return (
                      <Link
                        key={child.id}
                        href={`/parent/materials/${child.id}`}
                        className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition hover:bg-indigo-50 dark:hover:bg-indigo-950/30"
                      >
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-slate-100 bg-white text-slate-600 dark:border-slate-800 dark:bg-slate-950">
                          <ChildIcon className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-semibold text-slate-800 dark:text-slate-200">
                            {child.name}
                          </span>
                          <span className="text-muted-foreground block text-[10px]">
                            {child.item_count} 个学习点
                          </span>
                        </span>
                        <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
                      </Link>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        )}

        {/* Total-depth badge — how deep the whole hierarchy goes. */}
        <span className="px-0.5 text-sm font-extrabold text-slate-300 dark:text-slate-700">·</span>
        <span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          共 {totalDepth} 层
        </span>
      </div>

      {/* Page Title / Subtitle segment */}
      {subtitle && (
        <div className="flex items-center gap-2 pl-2">
          <span className="rounded border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-400">
            {KIND_LABEL[groupKind] || "素材"}
          </span>
          <p className="text-muted-foreground text-xs font-medium">{subtitle}</p>
        </div>
      )}
    </div>
  );
}
