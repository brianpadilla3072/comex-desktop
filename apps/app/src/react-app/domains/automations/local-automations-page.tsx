import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { useSpecialistApplications } from "../specialists/provider";
import { SpecialistTasksView } from "../specialists/library-dialog";

export function LocalAutomationsPage({ onShowDen }: { onShowDen: () => void }) {
  const applications = useSpecialistApplications();
  const navigate = useNavigate();
  const app = applications?.active;
  const client = applications?.client;
  return <main className="mx-auto w-full max-w-4xl space-y-4 p-4 sm:p-6" data-local-scheduled-tasks>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-base font-semibold">Tareas programadas</h1>
      <Button variant="ghost" size="sm" onClick={onShowDen}>Ver tareas de Den</Button>
    </div>
    <p className="text-xs text-muted-foreground">En el servidor de la aplicación · OpenCode · Sin cuenta de Den</p>
    {!applications?.catalog ? <p role="status" className="text-sm text-muted-foreground">{applications?.error ?? "Consultando la conexión local…"}</p>
      : !applications.catalog.scheduledTasksEnabled ? <p role="status" className="text-sm text-muted-foreground">Las tareas locales están desactivadas en esta instalación.</p>
      : !app || !client ? <div className="space-y-3"><p className="text-sm text-muted-foreground">Creá una aplicación y su proyecto para guardar las tareas.</p><Button onClick={() => applications.create()}>Crear aplicación</Button></div>
      : !app.workspaceIds.length ? <div className="space-y-3"><p className="text-sm text-muted-foreground">Esta aplicación necesita un proyecto para ejecutar sus tareas.</p><Button onClick={() => applications.createProject()}>Crear proyecto</Button></div>
      : <SpecialistTasksView key={`${client.baseUrl}:${app.id}`} app={app} client={client} dryRun={applications.catalog.taskDryRunEnabled === true} onBack={() => navigate(`/workspace/${encodeURIComponent(app.workspaceIds[0]!)}/session`)} />}
  </main>;
}
