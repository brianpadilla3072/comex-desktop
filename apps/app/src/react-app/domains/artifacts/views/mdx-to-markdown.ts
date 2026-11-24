/** Native MDX → Markdown conversion for the integrated viewer.
 *
 * The old MdxPreview compiled MDX with `new Function` semantics inside an
 * iframe that loaded React from esm.sh: a browser app with a network dependency
 * and no way for the host to control it. Here we parse MDX into an mdast tree
 * and serialize it with handlers that drop the parts needing code execution
 * (ESM imports/exports and JS expressions) and unwrap JSX into its children.
 * The result is plain Markdown drawn by the shared renderer in the app itself:
 * no iframe, no eval, no network, same toolbar/theme/zoom as a .md document.
 *
 * Custom React components are intentionally not executed: their *content*
 * survives, their visual chrome does not. That is the price of a native,
 * sandboxed viewer; full-fidelity component MDX remains available in the
 * exported source. */

import { toMarkdown } from "mdast-util-to-markdown";
import type { Handle, Options } from "mdast-util-to-markdown";
import type { Root } from "mdast";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";

const processor = unified().use(remarkParse).use(remarkMdx);

/** Expressions are shown as source, never evaluated. */
const expression: Handle = node => {
  const value = typeof node.value === "string" ? node.value : "";
  return `\`{${value.replace(/`/g, "\\`")}}\``;
};

const options: Options = {
  bullet: "-",
  fences: true,
  rule: "-",
  handlers: {
    mdxjsEsm: () => "",
    mdxFlowExpression: expression,
    mdxTextExpression: expression,
    mdxJsxFlowElement: (node, _parent, state, info) => state.containerFlow(node, info),
    mdxJsxTextElement: (node, _parent, state, info) => state.containerPhrasing(node, info),
  },
};

/** Convert MDX source to Markdown. Never throws on malformed MDX: the caller
 *  still gets something renderable (the original source) and the app keeps
 *  working. Markdown input is returned unchanged. */
export function mdxToMarkdown(source: string): string {
  try {
    return toMarkdown(processor.parse(source) as Root, options).trim();
  } catch {
    return source;
  }
}
