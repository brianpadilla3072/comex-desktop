import { currentLocale, t } from "@/i18n";
import { compareProjects, type ProjectList, type ProjectSummary } from "@/app/lib/projects";

/** Page paths of the Projects experience (the API lives under `/specialist-projects`). */
export const PROJECTS_ROUTE = "/projects";
export const projectPageRoute = (workspaceId: string) => `${PROJECTS_ROUTE}/${encodeURIComponent(workspaceId)}`;

/** `/projects` or `/projects/<id>`: the Proyectos entry is the current destination. */
export const isProjectsPath = (pathname: string) => pathname === PROJECTS_ROUTE || pathname.startsWith(`${PROJECTS_ROUTE}/`);

/** The project shown at `/projects/<id>`, or null on any other path. */
export function projectIdFromPath(pathname: string): string | null {
  const match = /^\/projects\/([^/]+)\/?$/.exec(pathname);
  if (!match?.[1]) return null;
  try { return decodeURIComponent(match[1]); } catch { return null; }
}

export const PROJECT_SORTS = ["activity", "name", "created"] as const;
export type ProjectSort = (typeof PROJECT_SORTS)[number];
export const isProjectSort = (value: unknown): value is ProjectSort => PROJECT_SORTS.some(sort => sort === value);

/** Lower case without accents, so "proyeccion" finds "Proyección". */
export function foldSearchText(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es").trim();
}

/** Every word of the query must appear in the name, description or application name. */
export function filterProjects(projects: readonly ProjectSummary[], query: string): ProjectSummary[] {
  const words = foldSearchText(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [...projects];
  return projects.filter(project => {
    const haystack = foldSearchText(`${project.name}\n${project.description}\n${project.applicationName}`);
    return words.every(word => haystack.includes(word));
  });
}

const byName = (left: ProjectSummary, right: ProjectSummary) =>
  left.name.localeCompare(right.name, "es", { sensitivity: "base", numeric: true }) || (left.workspaceId < right.workspaceId ? -1 : left.workspaceId > right.workspaceId ? 1 : 0);

/** Pinned projects always lead (most recently pinned first); the rest follow the chosen order. */
export function sortProjects(projects: readonly ProjectSummary[], sort: ProjectSort): ProjectSummary[] {
  return [...projects].sort((left, right) => {
    if ((left.pinnedAt === null) !== (right.pinnedAt === null) || (left.pinnedAt !== null && right.pinnedAt !== null && left.pinnedAt !== right.pinnedAt)) {
      return compareProjects(left, right);
    }
    if (sort === "name") return byName(left, right);
    if (sort === "created") return right.createdAt - left.createdAt || byName(left, right);
    return compareProjects(left, right);
  });
}

export function visibleProjects(projects: readonly ProjectSummary[], query: string, sort: ProjectSort): ProjectSummary[] {
  return sortProjects(filterProjects(projects, query), sort);
}

/** Pinned projects for the sidebar "Fijados" group, in the server's pin order. */
export function pinnedProjects(projects: readonly ProjectSummary[]): ProjectSummary[] {
  return projects.filter(project => project.pinned).sort(compareProjects);
}

/** The list as it looks right after (un)pinning one project; used for the optimistic update. */
export function withProjectPinned(list: ProjectList, workspaceId: string, pinned: boolean, now: number): ProjectList {
  return {
    ...list,
    projects: list.projects.map(project => project.workspaceId === workspaceId
      ? { ...project, pinned, pinnedAt: pinned ? now : null }
      : project).sort(compareProjects),
  };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "Ahora", "hace 5 minutos", "hace 18 horas", then a short date ("17 sept", with the year when it is another one). */
export function formatProjectTime(timestamp: number, now: number, locale: string = currentLocale()): string {
  const delta = now - timestamp;
  if (delta < MINUTE) return t("projects_ui.time_now");
  if (delta < HOUR) return t("projects_ui.time_minutes", { count: Math.floor(delta / MINUTE) });
  if (delta < DAY) return t("projects_ui.time_hours", { count: Math.floor(delta / HOUR) });
  const date = new Date(timestamp);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(locale, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" }).format(date);
}
