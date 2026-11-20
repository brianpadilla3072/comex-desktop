import type { DesignKind } from "@openwork/types/designs";

import type { DesignPickerTarget } from "./design-picker-runtime";

/** The page a comment points into. */
export interface DesignPickerPage {
  id: string;
  title: string;
  file: string;
}

export interface DesignPointedComment {
  comment: string;
  page: DesignPickerPage;
  target: DesignPickerTarget;
}

export interface DesignPickerDesign {
  id: string;
  title: string;
  kind: DesignKind;
}

const quote = (value: string) => JSON.stringify(value);

/**
 * The message for the agent chat: the person's words as `text`, and a precise description of what
 * each comment points at as `context` (sent to the model, so it stays in English like other
 * model-facing text). Several comments go out as one numbered message.
 */
export function formatPointedComments(design: DesignPickerDesign, items: DesignPointedComment[]): { text: string; context: string } {
  const numbered = items.length > 1;
  const text = numbered
    ? items.map((item, index) => `${index + 1}. ${item.comment.trim()}`).join("\n")
    : (items[0]?.comment.trim() ?? "");
  const lines = [
    `The person pointed at ${numbered ? `${items.length} elements` : "an element"} of the design ${quote(design.title)} (${design.kind}, folder proyecto/diseno/${design.id}/).`,
    numbered ? "Each numbered request applies to the element with the same number. Change only what each one points at." : "Change only what they point at.",
  ];
  items.forEach((item, index) => {
    const { page, target } = item;
    lines.push(
      "",
      `${numbered ? `[${index + 1}] ` : ""}Page ${quote(page.title)} (id ${page.id}, file ${page.file})`,
      `  selector: ${target.selector}`,
      `  element: <${target.tag}>${target.text ? `, visible text: ${quote(target.text)}` : ""}`,
      `  box: x=${target.box.x} y=${target.box.y} width=${target.box.width} height=${target.box.height} (CSS px of the page)`,
    );
  });
  return { text, context: lines.join("\n") };
}
