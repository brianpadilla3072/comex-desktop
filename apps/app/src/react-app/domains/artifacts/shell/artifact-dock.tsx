import { Copy, Download, MessageSquarePlus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ArtifactDockProps {
  canRevert: boolean;
  onCopy: () => void;
  onExport: () => void;
  onRequestChange: () => void;
  onRevert: () => void;
}

export function ArtifactDock({ canRevert, onCopy, onExport, onRequestChange, onRevert }: ArtifactDockProps) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-t border-border px-3 py-2" role="toolbar" aria-label="Acciones del artefacto">
      <Button variant="ghost" size="sm" onClick={onCopy}><Copy className="size-4" />Copiar</Button>
      <Button variant="ghost" size="sm" onClick={onExport}><Download className="size-4" />Exportar .md</Button>
      <Button variant="ghost" size="sm" onClick={onRequestChange}><MessageSquarePlus className="size-4" />Pedir un cambio</Button>
      {canRevert ? <Button variant="ghost" size="sm" onClick={onRevert}><RotateCcw className="size-4" />Descartar</Button> : null}
    </div>
  );
}
