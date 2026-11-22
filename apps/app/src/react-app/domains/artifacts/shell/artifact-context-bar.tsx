import { MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Shown only over a real text selection ([patrones 4-5 del diseño]). */
export function ArtifactContextBar({ selectedText, onAskChange }: { selectedText: string; onAskChange: (text: string) => void }) {
  if (!selectedText.trim()) return null;
  return (
    <div className="pointer-events-auto absolute bottom-12 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg">
      <span className="max-w-[32ch] truncate text-muted-foreground">“{selectedText.trim()}”</span>
      <Button variant="ghost" size="sm" onClick={() => onAskChange(selectedText.trim())}>
        <MessageSquarePlus className="size-4" />Pedir cambio aquí
      </Button>
    </div>
  );
}
