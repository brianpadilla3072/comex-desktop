/** @jsxImportSource react */
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { MarkdownPreview } from "./preview";

interface MdxPreviewProps {
  content: string;
  className?: string;
}

// Parse static import specifiers from MDX source so they can be added to the
// iframe import map (mapping bare specifiers to esm.sh URLs).
function parseImports(content: string): string[] {
  const specs = new Set<string>();
  const re1 = /import\s+[\s\S]*?\s+from\s+["']([^"']+)["']/g;
  const re2 = /import\(\s*["']([^"']+)["']\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re1.exec(content)) !== null) specs.add(m[1]);
  while ((m = re2.exec(content)) !== null) specs.add(m[1]);
  return [...specs];
}

const CORE_IMPORTS: Record<string, string> = {
  "react": "https://esm.sh/react@19.2.0",
  "react/jsx-runtime": "https://esm.sh/react@19.2.0/jsx-runtime",
  "react-dom": "https://esm.sh/react-dom@19.2.0",
  "react-dom/client": "https://esm.sh/react-dom@19.2.0/client",
};

// Component map with inline styles (Tailwind is not available inside the iframe).
const COMPONENTS_CODE = `
const __components = {
  h1: (p) => React.createElement("h1", Object.assign({ style: { marginTop: 32, marginBottom: 16, fontSize: 30, fontWeight: 700, lineHeight: 1.15, fontFamily: "\\"Fraunces\\", Georgia, serif", letterSpacing: "-0.02em", color: "#0f172a" } }, p)),
  h2: (p) => React.createElement("h2", Object.assign({ style: { marginTop: 28, marginBottom: 10, fontSize: 22, fontWeight: 600, lineHeight: 1.25, fontFamily: "\\"Fraunces\\", Georgia, serif", letterSpacing: "-0.01em", color: "#0f172a" } }, p)),
  h3: (p) => React.createElement("h3", Object.assign({ style: { marginTop: 22, marginBottom: 8, fontSize: 18, fontWeight: 600, lineHeight: 1.3, fontFamily: "\\"Fraunces\\", Georgia, serif", color: "#1e293b" } }, p)),
  h4: (p) => React.createElement("h4", Object.assign({ style: { marginTop: 16, marginBottom: 6, fontSize: 15, fontWeight: 600, lineHeight: 1.4, fontFamily: "\\"Manrope\\", system-ui, sans-serif", color: "#334155", textTransform: "none", letterSpacing: "0" } }, p)),
  p: (p) => React.createElement("p", Object.assign({ style: { margin: "10px 0", lineHeight: 1.75, fontFamily: "\\"Manrope\\", system-ui, sans-serif", color: "#334155" } }, p)),
  a: (p) => React.createElement("a", Object.assign({ style: { color: "#0d9488", textDecoration: "underline", textUnderlineOffset: "3px" } }, p)),
  ul: (p) => React.createElement("ul", Object.assign({ style: { margin: "10px 0", paddingLeft: 24, listStyleType: "disc" } }, p)),
  ol: (p) => React.createElement("ol", Object.assign({ style: { margin: "10px 0", paddingLeft: 24, listStyleType: "decimal" } }, p)),
  li: (p) => React.createElement("li", Object.assign({ style: { margin: "5px 0", lineHeight: 1.7 } }, p)),
  blockquote: (p) => React.createElement("blockquote", Object.assign({ style: { margin: "16px 0", paddingLeft: 20, borderLeft: "3px solid #0d9488", fontStyle: "italic", color: "#475569", background: "rgba(13,148,136,0.04)", padding: "12px 20px", borderRadius: "0 8px 8px 0" } }, p)),
  code: (p) => React.createElement("code", Object.assign({ style: { padding: "2px 7px", borderRadius: 5, background: "rgba(13,148,136,0.08)", fontSize: 13, fontFamily: "\\"JetBrains Mono\\", monospace", color: "#0f766e" } }, p)),
  pre: (p) => React.createElement("pre", Object.assign({ style: { margin: "14px 0", padding: 16, borderRadius: 10, background: "#0f172a", color: "#e2e8f0", overflow: "auto", fontSize: 13, fontFamily: "\\"JetBrains Mono\\", monospace", lineHeight: 1.6 } }, p)),
  hr: (p) => React.createElement("hr", Object.assign({ style: { margin: "24px 0", border: "none", borderTop: "1px solid #e2e8f0" } }, p)),
  img: (p) => React.createElement("img", Object.assign({ style: { maxWidth: "100%", borderRadius: 10, margin: "14px 0", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" } }, p)),
  table: (p) => React.createElement("table", Object.assign({ style: { width: "100%", borderCollapse: "collapse", margin: "14px 0", fontSize: 14 } }, p)),
  th: (p) => React.createElement("th", Object.assign({ style: { border: "1px solid #e2e8f0", padding: "8px 12px", textAlign: "left", fontWeight: 600, background: "#f8fafc", fontFamily: "\\"Manrope\\", system-ui, sans-serif", fontSize: 13, textTransform: "none", letterSpacing: "0" } }, p)),
  td: (p) => React.createElement("td", Object.assign({ style: { border: "1px solid #e2e8f0", padding: "8px 12px" } }, p)),
};
`;

export function MdxPreview({ content, className }: MdxPreviewProps) {
  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [height, setHeight] = useState(200);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Listen for messages from the iframe.
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (e.data?.type === "mdx-error") setError(e.data.error ?? "Error desconocido");
      if (e.data?.type === "mdx-height" && typeof e.data.height === "number") {
        setHeight(Math.max(100, Math.min(e.data.height + 16, 4000)));
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // Compile MDX and build the iframe document.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setSrcDoc(null);
    setHeight(200);

    (async () => {
      try {
        // Dynamic import of @mdx-js/mdx (loaded lazily to keep bundle lean).
        const { compile } = await import("@mdx-js/mdx");
        const compiled = await compile(content, {
          outputFormat: "program",
          development: false,
        });
        const compiledCode = String(compiled);

        if (cancelled) return;

        // Build import map: core + user imports.
        const userImports = [...new Set([...parseImports(content), ...parseImports(compiledCode)])];
        const imports: Record<string, string> = { ...CORE_IMPORTS };
        for (const spec of userImports) {
          if (!imports[spec]) imports[spec] = `https://esm.sh/${spec}`;
        }
        const importMap = JSON.stringify({ imports });

        const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Manrope:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px 40px;
    font-family: "Manrope", system-ui, -apple-system, sans-serif;
    font-size: 15px; line-height: 1.7;
    color: #1c1917; background: transparent;
    max-width: 720px; margin-left: auto; margin-right: auto;
  }
  @media (prefers-color-scheme: dark) {
    body { color: #e7e5e4; }
    pre, code { background: #1c1917 !important; color: #d6d3d1 !important; }
    blockquote { background: rgba(13,148,136,0.08) !important; }
  }
  #root { min-height: 40px; }
  a { color: #0d9488; text-decoration: underline; text-underline-offset: 3px; }
  ::selection { background: rgba(13,148,136,0.2); }
  @media (max-width: 640px) {
    body { padding: 20px 24px; font-size: 14px; }
  }
</style>
<script type="importmap">${importMap}</script>
</head>
<body>
<div id="root"></div>
<script type="module">
import React from "react";
import { createRoot } from "react-dom/client";
${COMPONENTS_CODE}
// --- compiled MDX ---
${compiledCode}
// --- render ---
try {
  const root = createRoot(document.getElementById("root"));
  root.render(React.createElement(MDXContent, { components: __components }));
} catch (e) {
  parent.postMessage({ type: "mdx-error", error: String(e?.message ?? e) }, "*");
}
</script>
<script>
  window.addEventListener("error", (e) => {
    parent.postMessage({ type: "mdx-error", error: e.message || "Error de script" }, "*");
  });
  window.addEventListener("unhandledrejection", (e) => {
    parent.postMessage({ type: "mdx-error", error: String(e.reason?.message ?? e.reason ?? "Promise rechazada") }, "*");
  });
  const ro = new ResizeObserver(() => {
    parent.postMessage({ type: "mdx-height", height: document.documentElement.scrollHeight }, "*");
  });
  ro.observe(document.documentElement);
  // Reporte inicial.
  setTimeout(() => parent.postMessage({ type: "mdx-height", height: document.documentElement.scrollHeight }, "*"), 100);
</script>
</body>
</html>`;

        if (cancelled) return;
        setSrcDoc(html);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [content]);

  if (error) {
    return (
      <div className={cn("h-full overflow-auto", className)}>
        <div className="m-4 rounded border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <div className="font-medium">No se pudo renderizar el MDX</div>
          <pre className="mt-2 whitespace-pre-wrap text-xs opacity-80">{error}</pre>
          <div className="mt-3 text-xs text-muted-foreground">Mostrando como Markdown:</div>
        </div>
        <MarkdownPreview content={content} />
      </div>
    );
  }

  if (!srcDoc) {
    return (
      <div className={cn("flex h-full items-center justify-center text-muted-foreground", className)}>
        Compilando MDX…
      </div>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcDoc}
      title="MDX preview"
      sandbox="allow-scripts"
      className={cn("h-full w-full border-0", className)}
      style={{ height }}
    />
  );
}
