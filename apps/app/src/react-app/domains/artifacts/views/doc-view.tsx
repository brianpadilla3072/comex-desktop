import { MarkdownPreview } from "../../session/artifacts/preview";

/** The first renderer: a Markdown document, unlimited height inside the panel shell. */
export function DocView({ content }: { content: string }) {
  return <MarkdownPreview content={content} className="max-w-[68ch] p-6" />;
}
