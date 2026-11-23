/** Native MDX → Markdown conversion for the integrated viewer.
 *
 * The old MdxPreview compiled MDX with `new Function` semantics inside an
 * iframe that loaded React from esm.sh: a browser app with a network dependency
 * and no way for the host to control it. Here we parse MDX into an mdast tree,
 * drop the parts that need code execution (ESM imports/exports and JS
 * expressions) and unwrap JSX elements into their children. The result is
 * plain Markdown that the shared renderer draws in the app itself — no iframe,
 * no eval, no network, and the same toolbar/theme/zoom as a .md document.
 *
 * Custom React components are intentionally not executed: their *content*
 * survives, their visual chrome does not. That is the price of a native,
 * sandboxed viewer; full-fidelity component MDX remains available in the
 * exported source. */

import { toMarkdown } from "mdast-util-to-markdown";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type { Root, RootContent } from "mdast";

type Node = { type: string; children?: Node[]; value?: string; [key: string]: unknown };

const EXECUTED = new Set(["mdxFlowExpression", "mdxTextExpression"]);
const REMOVED = new Set(["mdxjsEsm"]);
const JSX = new Set(["mdxJsxFlowElement", "mdxJsxTextElement"]);

function strip(nodes: Node[]): Node[] {
  const result: Node[] = [];
  for (const node of nodes) {
    if (REMOVED.has(node.type)) continue;
    if (EXECUTED.has(node.type)) {
      result.push({ type: "inlineCode", value: `{${node.value ?? ""}}` });
      continue;
    }
    if (JSX.has(node.type)) {
      result.push(...strip(node.children ?? []));
      continue;
    }
    result.push(node.children ? { ...node, children: strip(node.children) } : node);
  }
  return result;
}

const processor = unified().use(remarkParse).use(remarkMdx);

/** Convert MDX source to Markdown. Never throws on malformed MDX: the caller
 *  still gets something renderable (the original source) and the app keeps
 *  working. Returns Markdown unchanged. */
export function mdxToMarkdown(source: string): string {
  try {
    const tree = processor.parse(source) as Root;
    const safe: Root = { ...tree, children: strip(tree.children) as RootContent[] };
    return toMarkdown(safe, { bullet: "-", fences: true, rule: "-" }).trim();
  } catch {
    return source;
  }
}
