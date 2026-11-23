/** @jsxImportSource react */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import type { OpenworkServerClient } from "@/app/lib/openwork-server";
import { PreviewError, PreviewLoading } from "../../session/artifacts/preview";
import { useArtifactUiStore } from "../state/artifact-store";
import { ArtifactBody } from "./artifact-body";
import { ArtifactContextBar } from "./artifact-context-bar";
import { ArtifactHeader } from "./artifact-header";
import { ArtifactStatusStrip } from "./artifact-status-strip";

interface StudioArtifactShellProps {
  client: OpenworkServerClient | null;
  appId: string;
  artifactId: string;
  workspaceId?: string;
  onClose: () => void;
  onRequestChange?: (prompt: string) => void;
}

export function StudioArtifactShell({ client, appId, artifactId, workspaceId, onClose, onRequestChange }: StudioArtifactShellProps) {
  const focusMode = useArtifactUiStore(state => state.focusMode);
  const setFocusMode = useArtifactUiStore(state => state.setFocusMode);
  const rememberArtifact = useArtifactUiStore(state => state.rememberArtifact);
  const [selectedText, setSelectedText] = React.useState("");

  React.useEffect(() => { rememberArtifact(artifactId); }, [artifactId, rememberArtifact]);

  const query = useQuery({
    queryKey: ["artifact", client?.baseUrl, appId, workspaceId, artifactId],
    queryFn: () => {
      if (!client) throw new Error("No hay conexión al proyecto");
      return client.getArtifact(appId, artifactId, workspaceId);
    },
    enabled: Boolean(client && appId && artifactId),
    retry: false,
    refetchInterval: 15_000,
  });

  const artifact = query.data;
  const [saveError, setSaveError] = React.useState("");
  const saveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  const persist = React.useCallback(async (patch: { title?: string; content?: string }) => {
    if (!client || !artifact) return;
    try {
      setSaveError("");
      await client.saveArtifactVersion(appId, artifactId, {
        type: artifact.meta.type,
        title: patch.title ?? artifact.meta.title,
        content: patch.content ?? artifact.content,
        status: artifact.meta.status,
      }, workspaceId);
      await query.refetch();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "No se pudo guardar el cambio.");
      await query.refetch();
    }
  }, [artifact, appId, artifactId, client, query, workspaceId]);

  const saveArtifact = React.useCallback((patch: { title?: string; content?: string }) => {
    // Editing cells fires one change per keystroke: coalesce them into one version.
    if (patch.content !== undefined) {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        void persist(patch);
      }, 900);
      return;
    }
    void persist(patch);
  }, [persist]);

  const exportContent = React.useCallback(() => {
    if (!artifact) return;
    const blob = new Blob([artifact.content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${artifact.meta.id}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }, [artifact]);

  const askChange = React.useCallback((text?: string) => {
    const prompt = `Pide un cambio en el artefacto "${artifact?.meta.title ?? artifactId}".${text ? `\n\nTexto seleccionado: "${text}"` : ""}\n\nCambio solicitado: `;
    if (onRequestChange) onRequestChange(prompt);
    else void navigator.clipboard?.writeText(prompt);
  }, [artifact?.meta.title, artifactId, onRequestChange]);

  const readSelection = React.useCallback(() => {
    const selection = window.getSelection()?.toString() ?? "";
    setSelectedText(selection.length > 400 ? selection.slice(0, 400) : selection);
  }, []);

  if (!client || !appId) return <PreviewError message="No hay conexión al proyecto para abrir este artefacto." />;
  if (query.isPending) return <PreviewLoading />;
  if (query.isError || !artifact) return <PreviewError message={query.error instanceof Error ? query.error.message : "No se pudo leer el artefacto."} />;

  return (
    <div className="relative flex h-full min-h-0 flex-col" onMouseUp={readSelection}>
      <ArtifactHeader
        meta={artifact.meta}
        focusMode={focusMode}
        canRevert={artifact.meta.versions.length > 1}
        onToggleFocus={() => setFocusMode(!focusMode)}
        onCopy={() => void navigator.clipboard?.writeText(artifact.content)}
        onExport={exportContent}
        onRequestChange={() => askChange()}
        onRevert={() => {
          const previous = artifact.meta.versions.at(-2);
          if (previous && client) void client.revertArtifact(appId, artifactId, previous.id, workspaceId).then(() => query.refetch());
        }}
        onClose={onClose}
      />
      <ArtifactStatusStrip meta={artifact.meta} />
      {saveError ? <div role="alert" className="border-b bg-muted px-4 py-2 text-xs text-destructive">{saveError}</div> : null}
      <div className="min-h-0 flex-1 overflow-auto" data-testid="artifact-body">
        <ArtifactBody artifact={artifact} client={client} appId={appId} workspaceId={workspaceId} onSave={saveArtifact} />
      </div>
      <ArtifactContextBar selectedText={selectedText} onAskChange={text => askChange(text)} />
    </div>
  );
}
