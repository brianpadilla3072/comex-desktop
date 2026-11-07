import { useState } from "react";
import { FilePlus, FolderOpen, Paperclip, Plug, Plus, Puzzle, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { CloudImportedPlugin } from "@/app/cloud/import-state";
import type { SkillCard } from "@/app/types";
import type { PlusMenuConnector } from "./composer-plus-menu-model";
import type { ComposerPlusMenuPick } from "./composer-plus-menu";

export function ComposerSourcesMenu(props: {
  open: boolean; onOpenChange: (open: boolean) => void;
  plugins: CloudImportedPlugin[]; connectors: PlusMenuConnector[]; skills: SkillCard[];
  loading: boolean; attachmentsEnabled: boolean; attachmentsDisabledReason: string | null;
  onAttach: () => void; onAttachFolder: () => void; onPick: (item: ComposerPlusMenuPick) => void;
  onManage: () => void; onConnect: (connector: PlusMenuConnector) => void;
}) {
  const [query, setQuery] = useState("");
  const matches = (label: string) => label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const plugins = props.plugins.filter(item => matches(item.name));
  const connectors = props.connectors.filter(item => matches(item.name));
  const skills = props.skills.filter(item => matches(item.name) && !props.plugins.some(plugin => plugin.files.some(file => file.path === item.path)));
  const pick = (item: ComposerPlusMenuPick) => { props.onOpenChange(false); props.onPick(item); };
  return <DropdownMenu open={props.open} onOpenChange={open => { props.onOpenChange(open); if (!open) setQuery(""); }}>
    <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="size-6" aria-label="Agregar fuentes"><Plus className="size-4" /></Button>} />
    <DropdownMenuContent align="end" side="bottom" className="w-64">
      <DropdownMenuSub><DropdownMenuSubTrigger><Puzzle className="size-4" />Usar complementos</DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-64" side="left">
          <div className="p-1"><Input aria-label="Buscar complementos" placeholder="Buscar complementos…" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key.length === 1) event.stopPropagation(); }} /></div>
          {props.loading && <div role="status" className="px-2 py-1 text-xs text-muted-foreground">Cargando complementos…</div>}
          {plugins.map(plugin => <DropdownMenuSub key={plugin.pluginId}><DropdownMenuSubTrigger><Puzzle className="size-4" /><span className="truncate">{plugin.name}</span></DropdownMenuSubTrigger><DropdownMenuSubContent className="w-64">
            {plugin.files.filter(file => file.objectType !== "agent" && file.objectType !== "mcp").map(file => <DropdownMenuItem key={file.configObjectId} onClick={() => pick({ kind: "plugin-file", id: file.configObjectId, label: file.title, highlights: [], file })}>{file.title}</DropdownMenuItem>)}
            {!plugin.files.some(file => file.objectType !== "agent" && file.objectType !== "mcp") && <DropdownMenuItem disabled>Sin acciones para insertar</DropdownMenuItem>}
          </DropdownMenuSubContent></DropdownMenuSub>)}
          {connectors.map(connector => <DropdownMenuItem key={connector.key} disabled={connector.connecting} onClick={() => { if (connector.signIn) { props.onOpenChange(false); props.onConnect(connector); } else pick({ kind: "connector", id: connector.key, label: connector.name, highlights: [], connector }); }}><Plug className="size-4" /><span className="truncate">{connector.name}</span></DropdownMenuItem>)}
          {skills.map(skill => <DropdownMenuItem key={skill.path || skill.name} onClick={() => pick({ kind: "skill", id: skill.path || skill.name, label: skill.name, highlights: [], skill })}><BookOpen className="size-4" /><span className="truncate">{skill.name}</span></DropdownMenuItem>)}
          {!props.loading && !plugins.length && !connectors.length && !skills.length && <div className="p-2 text-xs text-muted-foreground">{query ? "Sin coincidencias" : "Sin complementos disponibles"}</div>}
          <DropdownMenuSeparator /><DropdownMenuItem onClick={() => { props.onOpenChange(false); props.onManage(); }}><Plug className="size-4" />Conectar complementos</DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub><DropdownMenuSubTrigger disabled={!props.attachmentsEnabled} title={props.attachmentsDisabledReason ?? undefined}><Paperclip className="size-4" />Adjuntar archivos o carpetas</DropdownMenuSubTrigger><DropdownMenuSubContent>
        <DropdownMenuItem onClick={() => { props.onOpenChange(false); props.onAttach(); }}><FilePlus className="size-4" />Archivos</DropdownMenuItem>
        <DropdownMenuItem onClick={() => { props.onOpenChange(false); props.onAttachFolder(); }}><FolderOpen className="size-4" />Carpeta</DropdownMenuItem>
      </DropdownMenuSubContent></DropdownMenuSub>
    </DropdownMenuContent>
  </DropdownMenu>;
}
