/** @jsxImportSource react */
import { useMemo } from "react";

interface BoardViewProps { content: string }

interface Node { id: string; kind: "note" | "section" | "text"; x: number; y: number; text: string }
interface Edge { id: string; from: string; to: string; label?: string }

/** Minimal renderer for the board artifact: lists nodes and connections. */
export function BoardView({ content }: BoardViewProps) {
  const parsed = useMemo(() => {
    try { return JSON.parse(content) as { nodes?: Node[]; edges?: Edge[] }; } catch { return null; }
  }, [content]);
  const nodes = parsed?.nodes ?? [];
  const edges = parsed?.edges ?? [];

  if (nodes.length === 0 && edges.length === 0) {
    return <div className="p-6 text-sm text-muted-foreground" role="status">El tablero está vacío.</div>;
  }

  return (
    <div className="grid gap-4 p-6" data-testid="board-view">
      <section className="rounded-lg border p-4">
        <h3 className="text-sm font-semibold">Nodos ({nodes.length})</h3>
        <ul className="mt-2 grid gap-1 text-xs">
          {nodes.map(node => (
            <li key={node.id} data-testid={`node-${node.id}`}>{node.kind}: {node.text} ({node.x},{node.y})</li>
          ))}
        </ul>
      </section>
      <section className="rounded-lg border p-4">
        <h3 className="text-sm font-semibold">Conexiones ({edges.length})</h3>
        <ul className="mt-2 grid gap-1 text-xs">
          {edges.map(edge => (
            <li key={edge.id} data-testid={`edge-${edge.id}`}>{edge.from} → {edge.to}{edge.label ? ` (${edge.label})` : ""}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
