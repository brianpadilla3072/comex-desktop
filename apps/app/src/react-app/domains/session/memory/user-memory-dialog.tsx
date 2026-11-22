/** @jsxImportSource react */
import { useState } from "react";
import { Brain, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useUserMemoryStore } from "./user-memory-store";

export function UserMemoryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const facts = useUserMemoryStore((s) => s.facts);
  const add = useUserMemoryStore((s) => s.add);
  const remove = useUserMemoryStore((s) => s.remove);
  const clear = useUserMemoryStore((s) => s.clear);
  const [text, setText] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Brain className="size-4" />Memoria global</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">Facts que Claude/OpenWork recordará en todas las conversaciones.</p>
          <div className="flex gap-2">
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Nuevo fact..." onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) { add(text); setText(""); } }} />
            <Button size="sm" onClick={() => { if (text.trim()) { add(text); setText(""); } }}><Plus className="size-4" /></Button>
          </div>
          <ul className="max-h-60 space-y-1 overflow-auto">
            {facts.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-sm">
                <span className="min-w-0 flex-1 truncate">{f.text}</span>
                <Button variant="ghost" size="icon-sm" onClick={() => remove(f.id)}><Trash2 className="size-3.5" /></Button>
              </li>
            ))}
            {facts.length === 0 && <li className="text-xs text-muted-foreground">Sin facts guardados.</li>}
          </ul>
          {facts.length > 0 && <Button variant="ghost" size="sm" onClick={clear}>Limpiar todo</Button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}