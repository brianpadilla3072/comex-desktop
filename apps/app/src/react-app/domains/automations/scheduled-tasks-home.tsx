/** @jsxImportSource react */
import { useState } from "react"
import { ListFilter, Plus, Search } from "lucide-react"
import type { AutomationList, CreateAutomation } from "@openwork/types/automations"
import { useUiStateStore } from "@/react-app/shell/ui-state-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatAutomationTime } from "./automation-format"

type TaskPreset = Pick<CreateAutomation, "name" | "instructions" | "schedule">

export function scheduledTaskPresets(timezone: string) {
  return [
    { icon: "📖", name: "Buscar lecturas para el fin de semana", instructions: "Envíame un buen artículo para leer cada sábado.", schedule: { kind: "weekly", timezone, daysOfWeek: [6], hour: 9, minute: 0 } },
    { icon: "🛍️", name: "Alertas de precios", instructions: "Revisa los precios diariamente y avísame cuando mi artículo cueste menos.", schedule: { kind: "daily", timezone, hour: 9, minute: 0 } },
    { icon: "🎵", name: "Buscar conciertos", instructions: "Busca cada semana nuevos conciertos que encajen con mis gustos.", schedule: { kind: "weekly", timezone, daysOfWeek: [1], hour: 9, minute: 0 } },
    { icon: "📍", name: "Planificar mi fin de semana", instructions: "Envíame cada jueves ideas de planes para el fin de semana en mi zona.", schedule: { kind: "weekly", timezone, daysOfWeek: [4], hour: 9, minute: 0 } },
    { icon: "🥗", name: "Plan semanal de comidas", instructions: "Planifica las comidas de la semana y haz una lista de la compra.", schedule: { kind: "weekly", timezone, daysOfWeek: [0], hour: 9, minute: 0 } },
    { icon: "😴", name: "Asesoramiento para dormir mejor", instructions: "Haz un seguimiento de la calidad de mi sueño y ayúdame a mejorar mis hábitos.", schedule: { kind: "daily", timezone, hour: 9, minute: 0 } },
  ] satisfies (TaskPreset & { icon: string })[]
}

export function ScheduledTasksHome(props: {
  items: AutomationList["items"]
  query: string
  onQueryChange: (query: string) => void
  onCreate: (preset?: TaskPreset) => void
  onOpen: (id: string) => void
}) {
  const sidebarOpen = useUiStateStore(state => state.sidebarOpen)
  const [searchOpen, setSearchOpen] = useState(false)
  const [upcomingOnly, setUpcomingOnly] = useState(false)
  const items = props.items.filter(item => !upcomingOnly || item.automation.state === "active")
    .toSorted((a, b) => (a.automation.nextDueAt ?? Infinity) - (b.automation.nextDueAt ?? Infinity))
  return (
    <div className="flex min-h-full flex-col bg-background md:flex-row" data-scheduled-tasks-home>
      <aside className={`shrink-0 border-b border-border bg-muted/10 px-4 py-3 md:w-72 md:border-r md:border-b-0 ${sidebarOpen ? "" : "md:hidden"}`} aria-label="Tareas programadas">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-base font-semibold">Tareas programadas</h1>
          <Button variant="ghost" size="icon-sm" aria-label="Buscar tareas programadas" aria-expanded={searchOpen} onClick={() => setSearchOpen(!searchOpen)}><Search className="size-3.5 text-muted-foreground" /></Button>
        </div>
        {searchOpen ? <Input autoFocus className="mt-3" aria-label="Buscar tareas programadas" placeholder="Buscar tareas" value={props.query} onChange={event => props.onQueryChange(event.currentTarget.value)} /> : null}
        <Button variant="ghost" className="mt-2 w-full justify-start px-0 font-normal" onClick={() => props.onCreate()}><Plus className="text-muted-foreground" />Nueva tarea</Button>
        <div className="mt-2 flex items-center justify-between text-sm text-muted-foreground">
          <span>{upcomingOnly ? "Activas" : "Próximas"}</span>
          <Button variant="ghost" size="icon-sm" aria-label="Mostrar solo tareas activas" aria-pressed={upcomingOnly} onClick={() => setUpcomingOnly(!upcomingOnly)}><ListFilter className="size-4" /></Button>
        </div>
        <div className="mt-2 space-y-1">
          {items.length === 0 ? <p className="text-xs text-muted-foreground">{props.query ? "No hay tareas que coincidan" : "No hay tareas programadas"}</p> : items.map(item => (
            <Button key={item.automation.id} variant="ghost" className="h-auto w-full justify-start rounded-lg px-2 py-3 text-left font-normal whitespace-normal hover:bg-muted" data-automation-id={item.automation.id} onClick={() => props.onOpen(item.automation.id)}>
              <span className="min-w-0"><span className="block truncate">{item.automation.name}</span><span className="mt-1 block text-xs text-muted-foreground">{item.automation.state === "needs_attention" ? "Requiere atención" : item.automation.state === "inactive" ? "Inactiva" : formatAutomationTime(item.automation.nextDueAt)}</span></span>
            </Button>
          ))}
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 items-center justify-center px-6 py-16 lg:px-12">
        <div className="w-full max-w-3xl">
          <div className="mb-11 text-center">
            <div className="mb-3 text-5xl" aria-hidden="true">🕗</div>
            <h2 className="text-lg font-medium tracking-tight">Programar una tarea</h2>
            <p className="mt-1 text-sm text-muted-foreground">OpenWork puede encargarse de las tareas recurrentes para que no tengas que hacerlo tú.</p>
          </div>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            {scheduledTaskPresets(Intl.DateTimeFormat().resolvedOptions().timeZone).map(preset => (
              <Button key={preset.name} variant="ghost" className="h-auto min-h-28 justify-start gap-4 rounded-3xl border border-dashed border-border px-5 py-5 text-left font-normal whitespace-normal hover:bg-muted/40" onClick={() => props.onCreate(preset)}>
                <span className="w-6 shrink-0 text-center text-2xl" aria-hidden="true">{preset.icon}</span>
                <span className="min-w-0"><span className="block text-sm font-medium">{preset.name}</span><span className="mt-1 block text-sm leading-5 text-muted-foreground">{preset.instructions}</span></span>
              </Button>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
