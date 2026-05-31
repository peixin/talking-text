"use client";

import { useMemo } from "react";
import { Link } from "@/i18n/routing";
import { ArrowRight } from "lucide-react";
import type { GroupOut } from "@/lib/backend";
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

export function TagPathHeader({
  groupId,
  groupName,
  groupKind,
  allGroups,
  subtitle,
}: TagPathHeaderProps) {
  // 1. Find a leaf descendant node to get the complete tree path branch
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const leafNode = useMemo(() => {
    const visited = new Set<string>();
    let curr = allGroups.find((g) => g.id === groupId);
    while (curr) {
      if (visited.has(curr.id)) break;
      visited.add(curr.id);
      const children = allGroups.filter((g) => g.parent_id === curr?.id && !g.archived);
      if (children.length === 0) {
        return curr;
      }
      curr = children[0];
    }
    return allGroups.find((g) => g.id === groupId);
  }, [groupId, allGroups]);

  // 2. Compute read-only levels safely from the leafNode
  const readOnlyLevels = useMemo(() => {
    const path: string[] = [];
    const visited = new Set<string>();
    let curr = leafNode;
    while (curr) {
      if (visited.has(curr.id)) break;
      visited.add(curr.id);
      path.unshift(curr.name);
      const pid = curr.parent_id;
      if (!pid) break;
      curr = allGroups.find((g) => g.id === pid);
    }
    return path.length > 0 ? path : [groupName || "未分类"];
  }, [leafNode, groupName, allGroups]);

  // 3. Compute read-only level titles safely from the leafNode
  const readOnlyLevelTitles = useMemo(() => {
    const titles: string[] = [];
    const visited = new Set<string>();
    let curr = leafNode;
    while (curr) {
      if (visited.has(curr.id)) break;
      visited.add(curr.id);
      titles.unshift(curr.level_title || "");
      const pid = curr.parent_id;
      if (!pid) break;
      curr = allGroups.find((g) => g.id === pid);
    }
    return titles.map((t, idx) => t || LEVEL_PRESETS[idx] || `层级 ${idx + 1}`);
  }, [leafNode, allGroups]);

  // 4. Find the exact GroupOut object for each step of the read-only leaf-path
  const readOnlyPathGroups = useMemo(() => {
    const matched: (GroupOut | null)[] = [];
    const currentGroupNodes = allGroups.filter((g) => !g.archived);

    for (let idx = 0; idx < readOnlyLevels.length; idx++) {
      const currentName = readOnlyLevels[idx]?.trim().toLowerCase();
      if (!currentName) {
        matched.push(null);
        continue;
      }
      const parentNode = idx > 0 ? matched[idx - 1] : null;
      const matchedNode = currentGroupNodes.find((g) => {
        const nameMatches = g.name.trim().toLowerCase() === currentName;
        if (!nameMatches) return false;
        if (idx === 0) return !g.parent_id;
        return parentNode ? g.parent_id === parentNode.id : true;
      });

      if (matchedNode) {
        matched.push(matchedNode);
      } else {
        const anyMatch = currentGroupNodes.find((g) => g.name.trim().toLowerCase() === currentName);
        matched.push(anyMatch || null);
      }
    }
    return matched;
  }, [readOnlyLevels, allGroups]);

  // 5. Index of the currently viewed group in the full path branch
  const currentGroupIdx = useMemo(() => {
    return readOnlyPathGroups.findIndex((g) => g && g.id === groupId);
  }, [readOnlyPathGroups, groupId]);

  return (
    <div className="mb-6 flex flex-col gap-3">
      {/* Complete unified Tag Path Breadcrumbs chain (supports wrapping) */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-3 rounded-2xl border border-slate-100 bg-slate-50/50 p-4 shadow-sm dark:border-slate-800/40 dark:bg-slate-950/20">
        {readOnlyLevels.map((lvl, idx) => {
          const title = readOnlyLevelTitles[idx] || LEVEL_PRESETS[idx] || `层级 ${idx + 1}`;
          const targetGroup = readOnlyPathGroups[idx];
          const isAncestor = idx < currentGroupIdx;
          const isCurrent = idx === currentGroupIdx;
          const isDirectChild = idx === currentGroupIdx + 1;

          let content: React.ReactNode;

          if (isAncestor) {
            content = (
              <div className="group relative flex cursor-pointer items-center gap-2 rounded-lg border border-slate-100 bg-white px-3.5 py-1.5 shadow-sm transition-all duration-200 hover:border-indigo-300 hover:bg-indigo-50/30 hover:shadow dark:border-slate-800/40 dark:bg-slate-950/20">
                <div className="flex flex-col items-start leading-none">
                  <span className="mb-1 text-[10px] leading-none font-bold tracking-wide text-indigo-500 uppercase transition-colors group-hover:text-indigo-600">
                    {title}
                  </span>
                  <span className="text-slate-880 text-sm leading-none font-bold transition-colors group-hover:text-indigo-600 dark:text-slate-200">
                    {lvl || "无"}
                  </span>
                </div>
              </div>
            );
          } else if (isCurrent) {
            content = (
              <div className="dark:border-indigo-850 relative flex scale-[1.01] items-center gap-2 rounded-lg border border-indigo-500 bg-indigo-50/70 px-3.5 py-1.5 font-extrabold text-indigo-900 shadow-sm ring-2 ring-indigo-500/10 transition-all duration-200 dark:bg-indigo-950/40 dark:text-indigo-200">
                <span className="flex animate-pulse items-center text-[11px] text-indigo-600 dark:text-indigo-400">
                  👉
                </span>
                <div className="flex flex-col items-start leading-none">
                  <span className="mb-1 text-[10px] leading-none font-bold tracking-wide text-indigo-600 uppercase dark:text-indigo-400">
                    {title}
                  </span>
                  <span className="text-sm leading-none font-bold text-indigo-950 dark:text-white">
                    {lvl || "无"}
                  </span>
                </div>
              </div>
            );
          } else if (isDirectChild) {
            content = (
              <Link href={`/parent/materials/${groupId}#sub-chapters-list`}>
                <div className="hover:border-indigo-550 group relative flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-indigo-400 bg-indigo-50/20 px-3.5 py-1.5 text-left leading-none shadow-sm transition-all duration-200 hover:bg-indigo-100/30">
                  <div className="flex flex-col items-start leading-none">
                    <span className="mb-1 text-[10px] leading-none font-bold tracking-wide text-indigo-500 uppercase transition-colors group-hover:text-indigo-600">
                      下级层级
                    </span>
                    <span className="flex items-center gap-1 text-sm leading-none font-bold text-indigo-700 transition-colors group-hover:text-indigo-900">
                      [ 选择{title} ]<span className="animate-bounce pl-0.5 text-[10px]">👇</span>
                    </span>
                  </div>
                </div>
              </Link>
            );
          } else {
            // Grandchild / Deeper descendants
            content = (
              <div className="relative flex cursor-default items-center gap-2 rounded-lg border border-slate-100 bg-white px-3.5 py-1.5 text-slate-500 shadow-sm select-none dark:border-slate-800/40 dark:bg-slate-950/20">
                <div className="flex flex-col items-start leading-none">
                  <span className="mb-1 text-[10px] leading-none font-bold tracking-wide text-slate-400 uppercase">
                    后续层级
                  </span>
                  <span className="dark:text-slate-350 text-sm leading-none font-bold text-slate-500">
                    [ {title} ]
                  </span>
                </div>
              </div>
            );
          }

          return (
            <div key={idx} className="flex items-center gap-1">
              {idx > 0 &&
                (isCurrent ? (
                  <span className="flex animate-pulse items-center px-0.5 text-sm font-extrabold text-indigo-600 dark:text-indigo-400">
                    <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                ) : (
                  <span className="px-0.5 text-sm font-extrabold text-slate-300 dark:text-slate-700">
                    ›
                  </span>
                ))}
              {isAncestor && targetGroup ? (
                <Link href={`/parent/materials/${targetGroup.id}`}>{content}</Link>
              ) : (
                content
              )}
            </div>
          );
        })}
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
