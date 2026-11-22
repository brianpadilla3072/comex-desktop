import { useLayoutEffect, useRef, useState } from "react"
import { Monitor } from "lucide-react"
import { OpenworkServerError, type OpenworkServerClient } from "@/app/lib/openwork-server"
import { Button } from "@/components/ui/button"
import { t } from "@/i18n"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

type Status = Awaited<ReturnType<OpenworkServerClient["cloudComputerStatus"]>>
type Frame = Awaited<ReturnType<OpenworkServerClient["cloudComputerFrame"]>>
const keys = new Map([["Enter", "enter"], ["Tab", "tab"], ["Escape", "escape"], ["Backspace", "backspace"], ["Delete", "delete"], ["ArrowUp", "arrowup"], ["ArrowDown", "arrowdown"], ["ArrowLeft", "arrowleft"], ["ArrowRight", "arrowright"]])

/** The user and agent watch and operate the very same VM desktop. */
export function CloudComputerControl({ client }: { client: OpenworkServerClient }) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)
  const [frame, setFrame] = useState<Frame | null>(null)
  const [error, setError] = useState("")
  const [needsSetup, setNeedsSetup] = useState(false)
  const [busy, setBusy] = useState(false)
  const epoch = useRef(0)
  const sending = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => {
    const generation = ++epoch.current
    setStatus(null); setFrame(null); setError(""); setNeedsSetup(false)
    if (!open) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    const update = async () => {
      try {
        const next = await client.cloudComputerStatus()
        if (disposed || generation !== epoch.current) return
        setStatus(next)
        const image = await client.cloudComputerFrame()
        if (disposed || generation !== epoch.current) return
        setFrame(image); setError(""); setNeedsSetup(false)
      } catch (cause) {
        if (!disposed && generation === epoch.current) { setFrame(null); setNeedsSetup(cause instanceof OpenworkServerError && cause.status === 404); setError(cause instanceof Error ? cause.message : t("secondary_ui.computer.cloud_reconnect")) }
      } finally { if (!disposed) timer = setTimeout(() => { if (document.visibilityState === "visible") void update(); else timer = setTimeout(update, 1500) }, 1000) }
    }
    void update()
    return () => { disposed = true; epoch.current++; clearTimeout(timer) }
  }, [client, open])
  async function act(body: Record<string, unknown>) {
    if (sending.current) return
    const generation = epoch.current
    sending.current = true; setBusy(true); setError("")
    try {
      await client.cloudComputerInteract(body)
      const next = await client.cloudComputerStatus()
      if (generation === epoch.current) { setStatus(next); setFrame(null) }
    } catch (cause) {
      if (generation === epoch.current) setError(cause instanceof Error ? cause.message : t("secondary_ui.computer.cloud_inspect"))
    } finally { sending.current = false; if (generation === epoch.current) setBusy(false) }
  }
  return <>
    <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("secondary_ui.computer.cloud_title")} data-testid="session-cloud-computer" onClick={() => setOpen(true)}><Monitor size={16} /></Button>} /><TooltipContent>{t("secondary_ui.computer.cloud_title")}</TooltipContent></Tooltip>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex max-h-[90vh] w-[min(1100px,95vw)] max-w-none sm:max-w-none flex-col gap-3" data-testid="cloud-computer-view">
        <DialogHeader><DialogTitle>{t("secondary_ui.computer.cloud_title")}</DialogTitle></DialogHeader>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span role="status" className="mr-auto">{needsSetup ? t("settings_ui.computer_setup_needed") : error ? t("secondary_ui.computer.cloud_connection_unavailable") : status?.paused ? t("secondary_ui.computer.cloud_you_have_control") : status?.busy ? t("secondary_ui.computer.crew_working") : status?.ready ? t("settings_ui.computer_ready") : t("secondary_ui.computer.status_connecting")}</span>
          {status?.paused ? <Button size="sm" disabled={busy || status.busy} onClick={() => void act({ action: "resume" })}>{t("secondary_ui.computer.continue")}</Button> : <Button size="sm" disabled={busy || !status?.ready} onClick={() => void act({ action: "takeover" })}>{t("secondary_ui.computer.take_over")}</Button>}
          <Button size="sm" variant="outline" disabled={busy || !status} onClick={() => void act({ action: "stop" })}>{t("secondary_ui.computer.stop")}</Button>
        </div>
        <div className="min-h-0 overflow-hidden rounded-md bg-muted" tabIndex={status?.paused ? 0 : -1} role="application" aria-label={t("secondary_ui.computer.cloud_remote_desktop")}
          onKeyDown={event => { const key = keys.get(event.key); if (!status?.paused || !frame || !key) return; event.preventDefault(); event.stopPropagation(); void act({ type: "key", key, generation: frame.generation }) }}>
          {frame ? <img src={frame.dataUrl} alt={t("secondary_ui.computer.cloud_live_desktop")} draggable={false} className="max-h-[65vh] w-full object-contain"
            onClick={event => {
              if (!status?.paused || busy) return
              const rect = event.currentTarget.getBoundingClientRect()
              const scale = Math.min(rect.width / frame.width, rect.height / frame.height)
              const x = (event.clientX - rect.left - (rect.width - frame.width * scale) / 2) / scale
              const y = (event.clientY - rect.top - (rect.height - frame.height * scale) / 2) / scale
              if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) return
              event.currentTarget.parentElement?.focus()
              void act({ type: "click", x: Math.floor(x * frame.screenWidth / frame.width), y: Math.floor(y * frame.screenHeight / frame.height), generation: frame.generation })
            }} /> : <div className={`aspect-video ${error ? "" : "animate-pulse"}`} aria-label={t("secondary_ui.computer.cloud_image_unavailable")} />}
        </div>
        {status?.paused ? <form className="flex gap-2" onSubmit={event => { event.preventDefault(); if (frame && input.current?.value) { const text = input.current.value; input.current.value = ""; void act({ type: "type", text, generation: frame.generation }) } }}>
          <Input ref={input} aria-label={t("secondary_ui.computer.cloud_type_aria")} placeholder={t("secondary_ui.computer.cloud_type_placeholder")} maxLength={500} disabled={busy || !frame} />
          <Button type="submit" variant="outline" disabled={busy || !frame}>{t("secondary_ui.computer.cloud_type")}</Button>
        </form> : null}
        {error ? <p role={needsSetup ? "status" : "alert"} className={`text-xs ${needsSetup ? "text-muted-foreground" : "text-destructive"}`}>{error}</p> : null}
      </DialogContent>
    </Dialog>
  </>
}
