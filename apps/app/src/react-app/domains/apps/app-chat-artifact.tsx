import { Blocks } from "lucide-react";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useEffect, useRef, useState } from "react";
import { useMessageList } from "@/components/chat/message-list-provider";
import { useUiStateStore } from "@/react-app/shell/ui-state-store";
import { usePanelSessionFor } from "@/react-app/kernel/panel-session-context";
import { usePanelTabStore } from "../session/panel/panel-tab-store";
import { type AppReference } from "./app-artifact";

export function AppChatArtifact({ appId, revisionId, receiptId, title, projectId, onAsk }: AppReference & { title: string; projectId?: string; onAsk?: (prompt: string) => Promise<void> }) {
   const { sessionId } = useMessageList();
   const panelSessionId = usePanelSessionFor(sessionId);
   const openedRef = useRef(false);
   const [templateOpen, setTemplateOpen] = useState(false);
   const artifactTemplates = ["Docs", "Slides", "Design"];
   const open = () => {
      usePanelTabStore.getState().openTab(panelSessionId, {
         type: "app", id: `app:${appId}:${revisionId}:${receiptId ?? "latest"}`, label: title, appId, revisionId, receiptId,
      });
      useUiStateStore.getState().setSidePanelState(panelSessionId, "panel");
   };
   // Apertura automática del panel lateral al generarse el artefacto (estilo Claude).
   useEffect(() => {
      if (openedRef.current) return;
      openedRef.current = true;
      open();
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, []);
   return <div className="mt-3 overflow-hidden rounded-xl border">
      <div className="flex items-center justify-between gap-3 border-b px-3 py-2"><span className="flex items-center gap-2 text-sm"><Blocks className="size-4" />{title}</span><div className="flex items-center gap-2">{onAsk ? <Button size="sm" variant="ghost" aria-label="Nuevo desde plantilla" onClick={() => setTemplateOpen(true)}>{t("secondary_ui.dashboard.new_from_template")}</Button> : null}<Button size="sm" variant="ghost" onClick={open}>{t("apps_ui.open_preview")}</Button></div></div>
      <p className="px-3 py-3 text-sm text-muted-foreground">{t("apps_ui.chat_artifact_hint")}</p>
      <Dialog open={templateOpen} onOpenChange={setTemplateOpen}>
         <DialogContent>
            <DialogHeader>
               <DialogTitle>{t("secondary_ui.dashboard.choose_template")}</DialogTitle>
               <DialogDescription>{t("secondary_ui.dashboard.template_desc")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2 py-2">
               {artifactTemplates.map((template) => (
                  <button key={template} type="button" className="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted/50" onClick={() => { setTemplateOpen(false); void onAsk?.(`Crea un artefacto tipo ${template}...`); }}>
                     <span>{template}</span>
                  </button>
               ))}
            </div>
         </DialogContent>
      </Dialog>
   </div>;
}