import { DESIGN_KINDS, foldDesignSearch, type DesignKind, type DesignSummary } from "@/app/lib/designs";

export type DesignScope = "all" | "project";
export type DesignView = "grid" | "list";

export const isDesignScope = (value: unknown): value is DesignScope => value === "all" || value === "project";
export const isDesignView = (value: unknown): value is DesignView => value === "grid" || value === "list";
export const isDesignKind = (value: unknown): value is DesignKind => DESIGN_KINDS.some(kind => kind === value);

/** "Este proyecto" keeps the current project's designs; every word of the query must match the title, kind label or project. */
export function visibleDesigns(designs: readonly DesignSummary[], options: { scope: DesignScope; workspaceId: string | null; query: string; kindLabel: (kind: DesignKind) => string }): DesignSummary[] {
  const words = foldDesignSearch(options.query).split(/\s+/).filter(Boolean);
  return designs.filter(design => {
    if (options.scope === "project" && design.workspaceId !== options.workspaceId) return false;
    if (!words.length) return true;
    const haystack = foldDesignSearch(`${design.title}\n${options.kindLabel(design.kind)}\n${design.projectName}`);
    return words.every(word => haystack.includes(word));
  });
}

/** Projects a new design can go in: the known projects, plus any project that already has designs. */
export function designProjectOptions(projects: readonly { workspaceId: string; name: string }[], designs: readonly DesignSummary[]): { workspaceId: string; name: string }[] {
  const seen = new Map(projects.map(project => [project.workspaceId, project.name]));
  for (const design of designs) if (!seen.has(design.workspaceId)) seen.set(design.workspaceId, design.projectName);
  return [...seen].map(([workspaceId, name]) => ({ workspaceId, name })).sort((left, right) => left.name.localeCompare(right.name, "es", { sensitivity: "base" }));
}
