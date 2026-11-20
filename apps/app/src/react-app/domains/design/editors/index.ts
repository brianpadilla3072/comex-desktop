import type { ComponentType } from "react";
import type { DesignKind } from "@/app/lib/designs";

import { PlaceholderEditor } from "./placeholder-editor";
import type { DesignEditorProps } from "./types";

export type { DesignEditorProps } from "./types";

/**
 * The editor of each design kind. Every kind starts with the placeholder (page list + page);
 * the kinds' own editors replace their entry when they land:
 *   slides → ./slides-editor, mockup → ./mockup-editor, system → ./system-editor, board → ./board-editor.
 */
export const DESIGN_EDITORS: Record<DesignKind, ComponentType<DesignEditorProps>> = {
  slides: PlaceholderEditor,
  mockup: PlaceholderEditor,
  system: PlaceholderEditor,
  board: PlaceholderEditor,
};

export function designEditorFor(kind: DesignKind): ComponentType<DesignEditorProps> {
  return DESIGN_EDITORS[kind];
}
