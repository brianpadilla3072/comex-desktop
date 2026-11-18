import { Maximize2, PanelRightClose, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ArtifactBase } from "../types";

interface ArtifactHeaderProps {
  meta: ArtifactBase;
  focusMode: boolean;
  onToggleFocus: () => void;
  onExport: () => void;
  onClose: () => void;
}

export function ArtifactHeader({ meta, focusMode, onToggleFocus, onExport, onClose }: ArtifactHeaderProps) {
  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-medium" title={meta.title}>{meta.title}</h2>
      </div>
      <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" size="icon-sm" onClick={onExport} aria-label="Compartir o exportar" />}>
          <Share2 className="size-4" />
        </TooltipTrigger>
        <TooltipContent>Compartir / Exportar</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" size="icon-sm" onClick={onToggleFocus} aria-label={focusMode ? "Mostrar chat" : "Maximizar artefacto"} />}>
          <Maximize2 className="size-4" />
        </TooltipTrigger>
        <TooltipContent>{focusMode ? "Mostrar chat" : "Maximizar"}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Cerrar artefacto" />}>
          <PanelRightClose className="size-4" />
        </TooltipTrigger>
        <TooltipContent>Cerrar</TooltipContent>
      </Tooltip>
    </header>
  );
}
