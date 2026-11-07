import { useMemo } from "react";
import { Check, ChevronRight, FileText, Search, SquareTerminal, Unplug, Minimize2 } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useWorkbenchDisclosure } from "@/react-app/domains/session/chat/workbench-ui-state";
import { formatElapsedSeconds } from "@/lib/tool-call-duration";
import type { AnyToolPart } from "@/lib/tool-aggregate";
import type { TextStepStatus } from "@/lib/text-activity";

export function toolInputText(input: unknown, keys: string[]): string {
  if (!input || typeof input !== "object") return "";
  for (const key of keys) { const value = Reflect.get(input, key); if (typeof value === "string" && value.trim()) return value.trim(); }
  return "";
}

export function ExecutionToolRow({ part, status, disclosureKey }: { part: AnyToolPart; status: TextStepStatus; disclosureKey?: string }) {
  const [open, setOpen] = useWorkbenchDisclosure(disclosureKey);
  const name = part.type === "dynamic-tool" ? part.toolName : part.type.slice(5);
  const command = toolInputText(part.input, ["command", "code", "script"]);
  const read = /^(read|read_file)$/.test(name);
  const search = /search|grep|glob|find/.test(name);
  const label = command || toolInputText(part.input, ["filePath", "path", "query", "pattern", "description"]) || name;
  const verb = status === "unknown" ? "Estado sin confirmar" : status === "waiting" ? "En espera" : status === "failed" ? "Falló" : status === "running"
    ? command ? "Ejecutando" : read ? "Leyendo" : search ? "Buscando" : "Usando"
    : command ? "Ejecutó" : read ? "Ha leído" : search ? "Ha buscado" : "Usó";
  const Icon = command ? SquareTerminal : read ? FileText : search ? Search : SquareTerminal;
  const output = part.state === "output-error" ? part.errorText : part.state === "output-available" ? part.output : null;
  return <Collapsible open={open} onOpenChange={setOpen} className="min-w-0" data-execution-tool={part.toolCallId}>
    <CollapsibleTrigger className="flex min-h-7 w-full min-w-0 items-center gap-2 text-left text-sm text-muted-foreground hover:text-foreground">
      <Icon className="size-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate" title={`${verb} ${label}`}>{open && command ? status === "running" ? "Comando en ejecución" : status === "failed" ? "El comando falló" : status === "done" ? "Comando ejecutado" : verb : `${verb} ${label}`}</span><ChevronRight className={`size-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
    </CollapsibleTrigger>
    <CollapsibleContent>
      {open ? <ExecutionDetails command={command} name={name} label={label} output={output} status={status} /> : null}
    </CollapsibleContent>
  </Collapsible>;
}

function ExecutionDetails({ command, name, label, output, status }: { command: string; name: string; label: string; output: unknown; status: TextStepStatus }) {
  const text = useMemo(() => output === null || output === undefined ? "" : typeof output === "string" ? output : JSON.stringify(output, null, 2), [output]);
  return <div className="my-2 rounded-[10px] border border-dls-border bg-dls-active px-2 py-1 text-xs text-dls-secondary" data-execution-details>
        <div className="mb-3">{command ? "Shell" : name}</div>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono leading-5">{command ? `$ ${command}` : label}{text ? `\n\n${text}` : ""}</pre>
        <div className="mt-2 flex items-center justify-end gap-1">{status === "done" && <Check className="size-3" />}{status === "done" ? "Listo" : status === "failed" ? "Falló" : status === "running" ? "En ejecución" : status === "waiting" ? "En espera" : "Estado sin confirmar"}</div>
      </div>;
}

export function ExecutionRunHeader({ seconds, disconnected = false, waiting = false, retrying = false, unconfirmed = false }: { unconfirmed?: boolean; seconds: number; disconnected?: boolean; waiting?: boolean; retrying?: boolean }) {
  return <div data-execution-run-header className="mb-4 border-b border-dls-border pb-2 text-sm text-muted-foreground">
    {disconnected ? <span className="inline-flex items-center gap-2"><Unplug className="size-3.5" />Reconectando…</span> : unconfirmed ? "Estado sin confirmar" : waiting ? "En espera de tu respuesta" : retrying ? "Reintentando…" : `En proceso desde hace ${formatElapsedSeconds(seconds)}`}
  </div>;
}

export function ContextCompactionLine({ active }: { active: boolean }) {
  return <div data-context-compaction={active ? "running" : "done"} role={active ? "status" : undefined} className="flex items-center gap-2 py-2 text-sm text-muted-foreground"><Minimize2 className="size-3.5 shrink-0" />{active ? "Compactando el contexto · Esto puede tardar unos minutos" : "Contexto compactado"}</div>;
}
