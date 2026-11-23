import { Copy, Download, Maximize2, MessageSquarePlus, PanelRightClose, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ArtifactBase } from "../types";

interface ArtifactHeaderProps {
  meta: ArtifactBase;
  focusMode: boolean;
  canRevert: boolean;
  onToggleFocus: () => void;
  onCopy: () => void;
  onExport: () => void;
  onRequestChange: () => void;
  onRevert: () => void;
  onClose: () => void;
}

/** All artifact actions live in one place: the header, next to maximize/close.
 *  The old bottom dock took a whole row away from the document being edited. */
export function ArtifactHeader({
  meta,
  focusMode,
  canRevert,
  onToggleFocus,
  onCopy,
  onExport,
  onRequestChange,
  onRevert,
  onClose,
}: ArtifactHeaderProps) {
  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2" role="toolbar" aria-label="Acciones del artefacto">
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-medium" title={meta.title}>{meta.title}</h2>
      </div>
      <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" size="icon-sm" onClick={onCopy} aria-label="Copiar contenido" />}>
          <Copy className="size-4" />
        </TooltipTrigger>
        <TooltipContent>Copiar</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" size="icon-sm" onClick={onExport} aria-label="Exportar .md" />}>
          <Download className="size-4" />
        </TooltipTrigger>
        <TooltipContent>Exportar .md</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" size="icon-sm" onClick={onRequestChange} aria-label="Pedir un cambio" />}>
          <MessageSquarePlus className="size-4" />
        </TooltipTrigger>
        <TooltipContent>Pedir un cambio</TooltipContent>
      </Tooltip>
      {canRevert ? (
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon-sm" onClick={onRevert} aria-label="Descartar cambios" />}>
            <RotateCcw className="size-4" />
          </TooltipTrigger>
          <TooltipContent>Descartar</TooltipContent>
        </Tooltip>
      ) : null}
      <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden="true" />
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
