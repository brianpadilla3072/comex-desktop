/** @jsxImportSource react */
import { useRef, useState } from "react"
import { ChevronDown, MessageCircle, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useComposerStateStore } from "../surface/composer-state-store"
import { NewTaskComposer, type NewTaskComposerProps } from "./new-task-composer"

export function WorkspaceResourceAssistant(props: Omit<NewTaskComposerProps, "draft" | "onDraftChange"> & { expanded?: boolean }) {
  const owner = props.context?.draftOwnerKey
  const [draft, setDraft] = useState(() => owner ? useComposerStateStore.getState().sessions[owner]?.draft ?? "" : "")
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  return <div ref={root} className="[&_[data-composer-editor]]:min-h-6! [&_[data-composer-editor]]:max-h-28!">
    {!open && !props.expanded ? <Button variant="ghost" className="h-11 w-full justify-start gap-3 rounded-full border border-border bg-muted px-4 text-muted-foreground" aria-label="Escribir al asistente" onClick={() => { setOpen(true); requestAnimationFrame(() => root.current?.querySelector<HTMLElement>("[data-composer-editor]")?.focus()) }}><Plus className="size-4" /><span className="min-w-0 flex-1 truncate text-left font-normal">{draft || "Dime qué quieres hacer"}</span><MessageCircle className="size-4" /></Button> : <div className="rounded-3xl bg-background p-1">
      {!props.expanded ? <div className="flex justify-end"><Button variant="ghost" size="icon-xs" aria-label="Contraer asistente" onClick={() => setOpen(false)}><ChevronDown className="size-3" /></Button></div> : null}
      <NewTaskComposer flush draft={draft} onDraftChange={setDraft} onRunTask={props.onRunTask} context={props.context} busy={props.busy} />
    </div>}
  </div>
}
