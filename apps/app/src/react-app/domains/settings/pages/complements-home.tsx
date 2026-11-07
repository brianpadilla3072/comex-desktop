/** @jsxImportSource react */
import { isValidElement, useState, type ReactNode } from "react"
import { Blocks, FileText, Search, Settings2 } from "lucide-react"
import { useUiStateStore } from "@/react-app/shell/ui-state-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { LibraryRow } from "./mcp-view"

export function ComplementsHome(props: {
  rows: LibraryRow[]
  skills: boolean
  search: string
  onSearch: (value: string) => void
  onSkills: (skills: boolean) => void
  addControl: ReactNode
  refreshControl: ReactNode
  onSettings: () => void
  catalog: ReactNode
  inventory: ReactNode
  personalInventory: ReactNode
  notice: ReactNode
}) {
  const sidebarOpen = useUiStateStore(state => state.sidebarOpen)
  const [personal, setPersonal] = useState(false)
  const installed = props.rows.filter(row => row.section === "mine" || (isValidElement<{ connected?: boolean }>(row.node) && row.node.props.connected))
  return <div className="flex min-h-full flex-col md:flex-row" data-complements-home>
    <aside className={`shrink-0 border-b border-border bg-muted/10 px-4 py-4 md:w-72 md:border-r md:border-b-0 ${sidebarOpen ? "" : "md:hidden"}`} aria-label="Personalizar">
      <div className="mb-4 flex items-center justify-between"><h1 className="text-base font-semibold">Personalizar</h1><Search className="size-3.5 text-muted-foreground" aria-hidden="true" /></div>
      <nav className="space-y-1">
        <Button variant="ghost" className={`h-8 w-full justify-start rounded-lg px-2 font-normal ${!props.skills ? "bg-muted" : ""}`} aria-pressed={!props.skills} onClick={() => props.onSkills(false)}><Blocks />Complementos</Button>
        <Button variant="ghost" className={`h-8 w-full justify-start rounded-lg px-2 font-normal ${props.skills ? "bg-muted" : ""}`} aria-pressed={props.skills} onClick={() => props.onSkills(true)}><FileText />Habilidades</Button>
      </nav>
      <p className="mt-6 mb-2 text-sm text-muted-foreground">Instalados</p>
      <div className="space-y-1 [&_[data-library-description]]:hidden [&_[data-library-status]]:hidden [&_[data-library-action]]:hidden [&_[data-library-integrated-row]]:h-8 [&_[data-library-integrated-row]>button>div]:size-5">
        {installed.length ? installed.map(row => <div key={row.key}>{row.node}</div>) : <p className="text-xs text-muted-foreground">No hay complementos instalados</p>}
      </div>
    </aside>
    <main className="min-w-0 flex-1 px-6 py-8 lg:px-12">
      <div className="mx-auto max-w-4xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-xl font-medium">{props.skills ? "Habilidades" : "Complementos"}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative"><Search className="absolute top-2.5 left-3 size-3.5 text-muted-foreground" /><Input className="h-8 w-60 rounded-full pl-9" value={props.search} onChange={event => props.onSearch(event.currentTarget.value)} placeholder={props.skills ? "Buscar habilidades" : "Buscar complementos"} aria-label={props.skills ? "Buscar habilidades" : "Buscar complementos"} /></div>
            {props.refreshControl}
            <Button variant="ghost" size="icon-sm" aria-label="Configuración de complementos" onClick={props.onSettings}><Settings2 className="size-4" /></Button>
            {props.addControl}
          </div>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">{props.skills ? "Añade habilidades para ampliar lo que puede hacer tu agente." : "Conecta complementos para que OpenWork pueda trabajar con tus herramientas."}</p>
        <div className="mt-5 mb-8 flex gap-1" aria-label="Origen de complementos">
          <Button variant="ghost" className={!personal ? "rounded-full bg-muted" : "rounded-full text-muted-foreground"} aria-pressed={!personal} onClick={() => setPersonal(false)}>Públicos</Button>
          <Button variant="ghost" className={personal ? "rounded-full bg-muted" : "rounded-full text-muted-foreground"} aria-pressed={personal} onClick={() => setPersonal(true)}>Personales</Button>
        </div>
        {props.notice}
        {props.skills ? props.inventory : personal ? props.personalInventory : props.catalog}
      </div>
    </main>
  </div>
}
