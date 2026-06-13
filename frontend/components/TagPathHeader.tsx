"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { ArrowUpRight, Bookmark, BookOpen, ChevronDown, Sparkles, Zap } from "lucide-react";
import type { GroupOut } from "@/lib/backend";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { LEVEL_PRESETS } from "@/lib/constants";

interface TagPathHeaderProps {
  groupId: string;
  groupName: string;
  groupKind: string;
  allGroups: GroupOut[];
  subtitle?: React.ReactNode;
}

const KIND_LABEL_KEY: Record<string, string> = {
  textbook_book: "kind_textbook_book",
  textbook_unit: "kind_textbook_unit",
  textbook_lesson: "kind_textbook_lesson",
  personal_collection: "kind_personal_collection",
  quick_practice: "kind_quick_practice",
  review_set: "kind_review_set",
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
  const t = useTranslations("TagPath");
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
      <div className="border-border bg-muted/30 flex flex-wrap items-center gap-x-1.5 gap-y-3 rounded-2xl border p-4 shadow-sm">
        {fullChain.crumbs.length === 0 ? (
          <div className="border-primary bg-primary/5 ring-ring/10 relative flex items-center gap-2 rounded-lg border px-3.5 py-1.5 shadow-sm ring-2">
            <span className="text-primary text-sm leading-none font-bold">
              {groupName || t("uncategorized")}
            </span>
          </div>
        ) : (
          fullChain.crumbs.map((node, idx) => {
            const title =
              node.level_title || LEVEL_PRESETS[idx] || t("level_fallback", { n: idx + 1 });
            const isCurrent = idx === fullChain.currentIdx;
            const isAncestor = idx < fullChain.currentIdx;

            const crumb = (
              <div
                className={cn(
                  "relative flex items-center gap-2 rounded-lg border px-3.5 py-1.5 shadow-sm transition-all duration-200",
                  isCurrent && "border-primary bg-primary/5 ring-ring/10 ring-2",
                  isAncestor &&
                    "border-border bg-card hover:border-primary/30 hover:bg-primary/5 group cursor-pointer hover:shadow",
                  !isCurrent &&
                    !isAncestor &&
                    "border-primary/20 bg-primary/5 hover:border-primary/30 hover:bg-primary/10 group cursor-pointer border-dashed",
                )}
              >
                <div className="flex flex-col items-start leading-none">
                  <span
                    className={cn(
                      "mb-1 flex items-center gap-1 text-[10px] leading-none font-bold tracking-wide uppercase transition-colors",
                      isCurrent
                        ? "text-primary"
                        : isAncestor
                          ? "text-primary/80 group-hover:text-primary"
                          : "text-primary/60 group-hover:text-primary",
                    )}
                  >
                    {title}
                    {isCurrent && (
                      <span className="bg-primary text-primary-foreground rounded-sm px-1 py-px text-[8px] leading-none font-bold tracking-normal normal-case">
                        {t("current_marker")}
                      </span>
                    )}
                  </span>
                  <span
                    className={cn(
                      "text-sm leading-none font-bold transition-colors",
                      isCurrent
                        ? "text-primary"
                        : isAncestor
                          ? "text-foreground group-hover:text-primary"
                          : "text-muted-foreground group-hover:text-primary",
                    )}
                  >
                    {node.name || t("none")}
                  </span>
                </div>
              </div>
            );

            return (
              <div key={node.id} className="flex items-center gap-1">
                {idx > 0 && (
                  <span className="text-muted-foreground/50 px-0.5 text-sm font-extrabold">›</span>
                )}
                {isCurrent ? crumb : <Link href={`/parent/materials/${node.id}`}>{crumb}</Link>}
              </div>
            );
          })
        )}

        {/* Branch point: fork → list children in a popover instead of picking one. */}
        {fullChain.branchChildren && (
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground/50 px-0.5 text-sm font-extrabold">›</span>
            <Popover>
              <PopoverTrigger className="border-primary/30 bg-primary/5 text-primary hover:border-primary hover:bg-primary/10 flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-1.5 text-[11px] font-bold transition-all">
                <ChevronDown className="h-3.5 w-3.5" />
                {t("branch_children", { count: fullChain.branchChildren.length })}
              </PopoverTrigger>
              <PopoverContent align="start" className="w-64 gap-1 p-1.5">
                <div className="text-muted-foreground/70 px-2 py-1 text-[9px] font-bold tracking-wider uppercase">
                  {t("branch_children_header", { count: fullChain.branchChildren.length })}
                </div>
                <div className="max-h-64 space-y-0.5 overflow-y-auto">
                  {fullChain.branchChildren.map((child) => {
                    const ChildIcon = KIND_ICON[child.kind] ?? Bookmark;
                    return (
                      <Link
                        key={child.id}
                        href={`/parent/materials/${child.id}`}
                        className="hover:bg-primary/5 flex items-center gap-2 rounded-lg px-2 py-1.5 transition"
                      >
                        <span className="border-border bg-card text-muted-foreground flex h-6 w-6 shrink-0 items-center justify-center rounded-md border">
                          <ChildIcon className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="text-foreground block truncate text-xs font-semibold">
                            {child.name}
                          </span>
                          <span className="text-muted-foreground block text-[10px]">
                            {t("items_count", { count: child.item_count })}
                          </span>
                        </span>
                        <ArrowUpRight className="text-primary/60 h-3.5 w-3.5 shrink-0" />
                      </Link>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        )}

        {/* Total-depth badge — how deep the whole hierarchy goes. */}
        <span className="text-muted-foreground/50 px-0.5 text-sm font-extrabold">·</span>
        <Badge
          variant="secondary"
          className="bg-muted text-muted-foreground h-auto rounded-md py-1 text-[11px] font-bold"
        >
          {t("depth_badge", { count: totalDepth })}
        </Badge>
      </div>

      {/* Page Title / Subtitle segment */}
      {subtitle && (
        <div className="flex items-center gap-2 pl-2">
          <Badge
            variant="outline"
            className="border-primary/20 bg-primary/5 text-primary h-auto rounded text-[10px] font-bold"
          >
            {t(KIND_LABEL_KEY[groupKind] ?? "kind_fallback")}
          </Badge>
          <p className="text-muted-foreground text-xs font-medium">{subtitle}</p>
        </div>
      )}
    </div>
  );
}
