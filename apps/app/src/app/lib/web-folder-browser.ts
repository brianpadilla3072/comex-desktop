import { z } from "zod";

/**
 * Web folder browser (docs/features/web-folder-browser): the browser cannot open a native folder
 * picker on the server's computer, so owners browse its folders through `GET /folders/browse`.
 */

export const folderListingSchema = z.object({
  path: z.string(),
  parent: z.string().nullable(),
  root: z.string(),
  roots: z.array(z.object({ name: z.string(), path: z.string() })),
  entries: z.array(z.object({ name: z.string(), path: z.string(), isGitRepo: z.boolean(), hasOpencode: z.boolean() })),
  truncated: z.boolean(),
});
export type FolderListing = z.infer<typeof folderListingSchema>;
export const createdFolderSchema = z.object({ path: z.string() });

/** What the dialog needs from the OpenWork server client; tests pass a fake. */
export type FolderBrowserClient = {
  browseFolders: (path?: string | null, options?: { hidden?: boolean }) => Promise<unknown>;
  createFolder: (parent: string, name: string) => Promise<unknown>;
};

export type FolderBreadcrumb = { name: string; path: string };

/** Crumbs from the listing's root down to its current folder. Works for `/` and `\` paths. */
export function folderBreadcrumbs(listing: Pick<FolderListing, "path" | "root" | "roots">): FolderBreadcrumb[] {
  const rootName = listing.roots.find(root => root.path === listing.root)?.name ?? listing.root;
  const crumbs: FolderBreadcrumb[] = [{ name: rootName, path: listing.root }];
  if (listing.path === listing.root || !listing.path.startsWith(listing.root)) return crumbs;
  const separator = listing.path.includes("\\") && !listing.path.includes("/") ? "\\" : "/";
  const base = listing.root.endsWith(separator) ? listing.root.slice(0, -1) : listing.root;
  let current = base;
  for (const segment of listing.path.slice(base.length).split(separator)) {
    if (!segment) continue;
    current = `${current}${separator}${segment}`;
    crumbs.push({ name: segment, path: current });
  }
  return crumbs;
}

/** Same rule as the server (contracts/folder-browser/v1): a single, non-empty folder name. */
export function isValidNewFolderName(name: string): boolean {
  if (!name.trim() || name !== name.trim() || name === "." || name === "..") return false;
  return !/[/\\\u0000-\u001f\u007f]/.test(name);
}
