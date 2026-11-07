import { create } from "zustand";
import { persist } from "zustand/middleware";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
export const useLocalPet = create<{ visible: boolean; toggle: () => void }>()(persist(set => ({ visible: false, toggle: () => set(state => ({ visible: !state.visible })) }), { name: "openwork.local-pet.v1" }));
/** Local UI ornament. It runs no agent and has no background work. */
export function LocalPet({ busy }: { busy: boolean }) {
  const visible = useLocalPet(state => state.visible); const toggle = useLocalPet(state => state.toggle);
  if (!visible) return null;
  return <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground" aria-label="Mascota de la app"><svg viewBox="0 0 48 40" className="h-10 w-12 text-foreground" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M9 19 7 4l12 8a20 20 0 0 1 10 0L41 4l-2 15c4 14-3 18-15 18S5 33 9 19Z"/><path d={busy ? "m15 23 4-2m10 0 4 2" : "M15 22h4m10 0h4"}/><path d="m22 27 2 2 2-2m-2 2v3m-12-5-8-1m8 5-8 2m32-6 8-1m-8 5 8 2"/></svg><span>{busy ? "Acompañando tu tarea" : "En pausa"}</span><Button variant="ghost" size="icon-sm" aria-label="Guardar mascota" onClick={toggle}><X className="size-3" /></Button></div>;
}
