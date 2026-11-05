/** A visual review fixture, outside the production entry. No model or network
 * calls: all content below is explicitly sample data, never TP evidence. */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowLeft, ArrowRight, Bell, ChevronDown, FileText, Folder, Globe, Mic, MoreHorizontal, PanelLeft, PanelRight, Plus, Search, ShieldCheck, SquarePen, Sun, Moon } from "lucide-react";
import { Button } from "./components/ui/button";
import { ComposerSendButton } from "./react-app/domains/session/surface/composer/composer-send-button";
import "./app/index.css";
import "./styles/comex-shell.css";

function DesignPreview() {
  const [dark, setDark] = useState(true);
  const [sidebar, setSidebar] = useState(true);
  const [panel, setPanel] = useState(true);
  const [draft, setDraft] = useState("");
  const toggleTheme = () => {
    document.documentElement.dataset.theme = dark ? "light" : "dark";
    setDark(!dark);
  };
  return (
    <div data-chat-viewport className="flex h-dvh flex-col bg-dls-surface text-foreground">
      <div className="flex h-10 shrink-0 items-center gap-4 border-b border-border px-4 text-xs text-muted-foreground">
        <ArrowLeft className="size-3.5" /><ArrowRight className="size-3.5" />
        <span>Archivo</span><span>Edición</span><span>Ver</span><span>Ayuda</span>
        <span className="ml-auto">Vista de diseño · datos de ejemplo</span>
        <Button variant="ghost" size="icon-xs" aria-label={dark ? "Usar tema claro" : "Usar tema oscuro"} onClick={toggleTheme}>{dark ? <Sun /> : <Moon />}</Button>
      </div>
      <div className="flex min-h-0 flex-1">
        {sidebar && <aside data-slot="sidebar-inner" className="hidden w-[290px] shrink-0 flex-col px-3 py-3 md:flex">
          <div data-sidebar-brand className="flex h-10 items-center px-2">
            <span className="text-base font-semibold">Comex</span><ChevronDown className="ml-2 size-3.5 text-muted-foreground" />
            <Bell className="ml-auto size-4 text-muted-foreground" /><Search className="ml-4 size-4 text-muted-foreground" />
          </div>
          <Button variant="ghost" className="mt-2 w-full justify-start gap-3 rounded-lg" onClick={() => setDraft("")}><SquarePen />Nuevo chat</Button>
          <h2 className="mb-2 mt-7 px-2 text-xs text-muted-foreground">Proyectos</h2>
          <div className="flex h-8 items-center gap-2 px-2"><Folder className="size-4" />TP 1 · Mercados externos</div>
          <div aria-current="page" className="ml-3 rounded-lg bg-sidebar-accent px-3 py-2">Plan de investigación</div>
          <div className="ml-3 px-3 py-2 text-muted-foreground">Encuesta y trabajo de campo</div>
          <div className="mt-1 flex h-8 items-center gap-2 px-2"><Folder className="size-4" />Cotizaciones</div>
          <div className="flex h-8 items-center gap-2 px-2"><Folder className="size-4" />Mi trabajo final</div>
          <h2 className="mb-2 mt-8 px-2 text-xs text-muted-foreground">Recientes</h2>
          <div className="space-y-3 px-2 text-muted-foreground"><p>Plan de investigación</p><p>Comparación de mercados</p><p>Preparar la defensa</p></div>
          <div className="mt-auto border-t border-border px-2 pt-4 text-xs text-muted-foreground">Comercio Exterior</div>
        </aside>}
        <main className="flex min-w-0 flex-1 flex-col">
          <header data-session-header className="flex h-12 shrink-0 items-center gap-3 px-4">
            <Button variant="ghost" size="icon-sm" aria-label="Mostrar u ocultar proyectos" aria-pressed={sidebar} onClick={() => setSidebar(!sidebar)}><PanelLeft /></Button>
            <Folder className="size-4 text-muted-foreground" /><h1 className="truncate text-[13px] font-medium">Plan de investigación</h1>
            <MoreHorizontal className="ml-auto size-4 text-muted-foreground" />
            <Button variant="ghost" size="icon-sm" aria-label="Mostrar u ocultar resultados" aria-pressed={panel} onClick={() => setPanel(!panel)}><PanelRight /></Button>
          </header>
          <div className="flex min-h-0 flex-1">
            <section data-session-pane className="flex min-w-0 flex-1 flex-col">
              <div data-thread-scroll className="min-h-0 flex-1 overflow-y-auto px-5 pt-10">
                <div data-comex-transcript className="mx-auto w-full max-w-[720px] space-y-9">
                  <div className="flex justify-end"><div data-comex-user-bubble className="max-w-[85%] bg-muted px-4 py-3 leading-6">Necesito empezar el TP del profesor. Son dos productos nacionales y destinos diferentes. Todavía no hice la encuesta.</div></div>
                  <div className="space-y-5 leading-7">
                    <p className="border-b border-border pb-3 text-xs text-muted-foreground">Ejemplo de conversación</p>
                    <p>Empecemos por elegir los dos productos y sus mercados. Voy a registrar cada requisito de la consigna y la evidencia que falta conseguir.</p>
                    <p>Para cada producto vamos a trabajar la selección del destino, las barreras, los competidores, los canales y la logística con su Incoterm.</p>
                    <p>Podemos preparar el cuestionario ahora. La encuesta quedará pendiente hasta que tengas respuestas reales; mientras tanto, avanzamos con la investigación de fuentes.</p>
                    <p>¿Tenés productos en mente o querés que preparemos una preselección?</p>
                  </div>
                </div>
              </div>
              <div className="shrink-0 px-4 pb-5 pt-6 lg:px-8">
                <div data-comex-composer className="mx-auto max-w-[800px] rounded-[18px] border border-border bg-background px-4 pb-3 pt-3">
                  <textarea aria-label="Mensaje de ejemplo, sin envío" placeholder="Contame qué necesitás para tu trabajo" value={draft} onChange={e => setDraft(e.target.value)} className="min-h-12 w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring" />
                  <div data-composer-toolbar className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                    <Plus className="size-4" /><ShieldCheck className="size-3.5" /><span>Con tu autorización</span>
                    <span className="ml-auto hidden sm:inline">Elegir modelo</span><ChevronDown className="size-3" /><Mic className="size-4" />
                    <ComposerSendButton mode="send" label="Envío desactivado en la vista de diseño" disabled ready={false} />
                  </div>
                </div>
              </div>
            </section>
            {panel && <aside className="hidden w-[300px] shrink-0 px-3 pt-3 xl:block">
              <div data-comex-side-panel className="rounded-2xl border border-border bg-card p-4">
                <h2 className="mb-4 text-xs text-muted-foreground">Resultados</h2>
                <div className="flex items-center gap-2"><FileText className="size-4 text-muted-foreground" /><span>El informe aparecerá acá</span></div>
                <h2 className="mb-3 mt-7 text-xs text-muted-foreground">Fuentes</h2>
                <div className="flex items-center gap-2 text-muted-foreground"><Globe className="size-4" /><span>Sin fuentes consultadas</span></div>
                <h2 className="mb-3 mt-7 text-xs text-muted-foreground">Trabajo de campo</h2>
                <p className="text-muted-foreground">Encuesta pendiente</p>
              </div>
            </aside>}
          </div>
        </main>
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<DesignPreview />);
