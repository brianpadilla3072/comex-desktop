import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
export function SketchDialog({ open, onClose, onAttach }: { open: boolean; onClose: () => void; onAttach: (files: File[]) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null); const drawing = useRef(false); const [marked, setMarked] = useState(false);
  const clear = () => { const el = canvas.current; const ctx = el?.getContext("2d"); if (!el || !ctx) return; ctx.fillStyle = getComputedStyle(el).backgroundColor; ctx.fillRect(0, 0, el.width, el.height); setMarked(false); };
  useEffect(() => { if (!open) return; const id = requestAnimationFrame(clear); return () => cancelAnimationFrame(id); }, [open]);
  return <Dialog open={open} onOpenChange={value => { if (!value) onClose(); }}><DialogContent aria-describedby={undefined} className="sm:max-w-2xl"><DialogHeader><DialogTitle>Dibujar un boceto</DialogTitle></DialogHeader><canvas ref={canvas} width={1000} height={600} aria-label="Lienzo para dibujar" className="aspect-5/3 w-full touch-none rounded-lg bg-background text-foreground ring-1 ring-border"
    onPointerDown={event => { const el = event.currentTarget; const ctx = el.getContext("2d"); if (!ctx) return; el.setPointerCapture(event.pointerId); drawing.current = true; const box = el.getBoundingClientRect(); ctx.strokeStyle = getComputedStyle(el).color; ctx.lineWidth = 4; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.beginPath(); ctx.moveTo((event.clientX - box.x) * el.width / box.width, (event.clientY - box.y) * el.height / box.height); }}
    onPointerMove={event => { if (!drawing.current) return; const el = event.currentTarget; const ctx = el.getContext("2d"); if (!ctx) return; const box = el.getBoundingClientRect(); ctx.lineTo((event.clientX - box.x) * el.width / box.width, (event.clientY - box.y) * el.height / box.height); ctx.stroke(); setMarked(true); }}
    onPointerUp={() => { drawing.current = false; }} onPointerCancel={() => { drawing.current = false; }} />
    <DialogFooter><Button variant="ghost" onClick={clear}>Limpiar lienzo</Button><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button disabled={!marked} onClick={() => { canvas.current?.toBlob(blob => { if (!blob) return; onAttach([new File([blob], "boceto.png", { type: "image/png" })]); onClose(); }, "image/png"); }}>Adjuntar boceto</Button></DialogFooter></DialogContent></Dialog>;
}
