/** @jsxImportSource react */
import type { ComponentType } from "react";
import type { DesignKind } from "@/app/lib/designs";

import { DesignFrame } from "../design-frame";
import { BoardEditor } from "./board-editor";
import { MockupEditor } from "./mockup-editor";
import { SlidesEditor } from "./slides-editor";
import { SystemEditor } from "./system-editor";
import type { DesignEditorProps } from "./types";

export type { DesignEditorProps } from "./types";

/**
 * The editor of each design kind. Every kind starts with the placeholder (page list + page);
 * the kinds' own editors replace their entry when they land:
 *   slides → ./slides-editor, mockup → ./mockup-editor, system → ./system-editor, board → ./board-editor.
 */
export const DESIGN_EDITORS: Record<DesignKind, ComponentType<DesignEditorProps>> = {
  slides: SlidesEditor,
  mockup: MockupEditor,
  // The system editor takes the viewer as a prop (it does not import design-frame itself).
  system: props => <SystemEditor {...props} frame={DesignFrame} />,
  board: BoardEditor,
};

export function designEditorFor(kind: DesignKind): ComponentType<DesignEditorProps> {
  return DESIGN_EDITORS[kind];
}
