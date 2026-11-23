/** Artifact UI contract ([diseño] §1.2). Mirrored by Zod in the server. Product behavior is
 *  gated by the `comexArtifacts` feature; these types are inert until the shell is enabled. */

export type ArtifactType = "doc" | "slides" | "sheet" | "board" | "data";
export type ArtifactStatus = "streaming" | "draft" | "saved" | "archived";
export type ArtifactAuthor = "agent" | "user";

export type ArtifactSourceRef =
  | { kind: "source"; id: string; label: string }
  | { kind: "dataset"; id: string; label: string }
  | { kind: "output"; id: string; appId: string; label: string };

export type ArtifactVersion = {
  id: string;
  createdAt: number;
  author: ArtifactAuthor;
  contentRef: string;
  label?: string;
};

export type ArtifactAudit = {
  total: number;
  valid: number;
  invalid: Array<{ sourceId: string; chunk: number; reason: string }>;
  note?: string;
};

export type ArtifactMetadata = {
  workspaceId: string;
  workspaceName?: string;
  schemaVersion: 1;
  outputRef?: { appId: string; outputId: string; workspaceId: string };
  audit?: ArtifactAudit;
  focus?: string;
  format?: "report" | "dashboard" | "compact" | "table" | "deck" | "canvas";
  theme?: string;
  /** State of the native MD/MDX viewer, written by specialist_doc_view. */
  viewer?: {
    format?: "md" | "mdx";
    theme?: "light" | "dark";
    zoom?: number;
    wrap?: boolean;
    outline?: boolean;
    scrollTo?: string;
  };
};

export interface ArtifactBase {
  id: string;
  type: ArtifactType;
  title: string;
  status: ArtifactStatus;
  sources: ArtifactSourceRef[];
  versions: ArtifactVersion[];
  metadata: ArtifactMetadata;
  createdAt: number;
  updatedAt: number;
}

export interface DocArtifact extends ArtifactBase { type: "doc"; content: string }
export interface SlidesArtifact extends ArtifactBase {
  type: "slides";
  content: { slides: Array<{ id: string; title?: string; blocks: Array<{ id: string; kind: "text" | "image" | "table" | "chart"; ref: string }>; notes?: string; skipped?: boolean }> };
}
export interface SheetArtifact extends ArtifactBase {
  type: "sheet";
  content: { sheets: Array<{ id: string; name: string; cells: Record<string, { value: string; formula?: string; format?: "number" | "currency" | "percent" | "date" }> }> };
}
export interface BoardArtifact extends ArtifactBase {
  type: "board";
  content: { nodes: Array<{ id: string; kind: "note" | "section" | "text"; x: number; y: number; text: string }>; edges: Array<{ id: string; from: string; to: string; label?: string }> };
}
export interface DataArtifact extends ArtifactBase {
  type: "data";
  content: { blocks: Array<{ id: string; kind: "stat" | "line" | "bar" | "table" | "markdown" | "changes"; source: { datasetId?: string; queryRef?: string }; note?: string }>; narrative?: string };
}

export type Artifact = DocArtifact | SlidesArtifact | SheetArtifact | BoardArtifact | DataArtifact;
export type ArtifactContentByType = {
  doc: DocArtifact["content"];
  slides: SlidesArtifact["content"];
  sheet: SheetArtifact["content"];
  board: BoardArtifact["content"];
  data: DataArtifact["content"];
};

/** One artifact as returned by the API: metadata + current content string. */
export type ArtifactRecord = { meta: ArtifactBase; content: string; truncated: boolean };
