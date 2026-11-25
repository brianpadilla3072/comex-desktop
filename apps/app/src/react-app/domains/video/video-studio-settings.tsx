/** @jsxImportSource react */
import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Mic, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import type { OpenworkServerClient } from "@/app/lib/openwork-server";
import { VideoVoiceRecorder } from "@/react-app/domains/session/surface/composer/video-voice-recorder";
import { videoActionPrompt, videoVoiceSavedPrompt } from "@/react-app/domains/video/video-actions";

type WorkspaceRef = {
  workspaceId: string;
  selectedWorkspaceRoot: string;
  openworkServerClient: OpenworkServerClient | null;
};

/** Workspace-wide video settings, shared by every video of this workspace. */
export type VideoSettings = {
  version?: number;
  voice?: string;
  referenceSets?: Array<{ id: string; name?: string; refs?: number; updatedAt?: string }>;
};

export type VoiceEntry = {
  id: string;
  hasRecording: boolean;
  hasConsent: boolean;
  hasProfile: boolean;
};

/** A reference set: the person's own library, or the mirrored global one. */
export type LibrarySet = {
  id: string;
  name?: string;
  refs?: number;
  measuredAt?: string;
  source: "own" | "global";
};

const SETTINGS_PATH = "video-settings.json";
const VOICE_DIR = "voices";
const LIBRARY_CATALOG = "video-library/references.json";
const LIBRARY_DIR = "video-library/references";

function readJson<T>(content: string): T {
  return JSON.parse(content.replace(/^\uFEFF/, "")) as T;
}

/** Lists the cloned voices and the global settings of this workspace. */
export function useVideoStudioSettings(workspace: WorkspaceRef) {
  const client = workspace.openworkServerClient;
  return useQuery({
    queryKey: ["video-studio-settings", workspace.workspaceId],
    enabled: Boolean(client && workspace.workspaceId),
    staleTime: 5_000,
    refetchOnWindowFocus: true,
    retry: false,
    queryFn: async (): Promise<{ settings: VideoSettings; voices: VoiceEntry[]; sets: LibrarySet[] }> => {
      if (!client) return { settings: {}, voices: [], sets: [] };
      let settings: VideoSettings = {};
      try {
        const file = await client.readWorkspaceFile(workspace.workspaceId, SETTINGS_PATH);
        settings = readJson<VideoSettings>(file.content);
      } catch {
        // No settings yet: the panel works with defaults.
      }
      // The person's own library lives in the workspace, so every install can
      // build its own set of references without touching a home folder.
      let ownSets: Array<{ id: string; name?: string; refs?: number; measuredAt?: string }> = [];
      try {
        const file = await client.readWorkspaceFile(workspace.workspaceId, LIBRARY_CATALOG);
        const parsed = readJson<{ sets?: Array<{ id: string; name?: string; refs?: number; measuredAt?: string }> }>(file.content);
        ownSets = parsed.sets ?? [];
      } catch {
        // No own library yet: it is created with the first upload.
      }
      const voices = new Map<string, VoiceEntry>();
      try {
        const catalog = await client.listWorkspaceFiles(workspace.workspaceId);
        for (const item of catalog.items) {
          if (!item.path.startsWith(`${VOICE_DIR}/`)) continue;
          const [folder, ...rest] = item.path.slice(VOICE_DIR.length + 1).split("/");
          if (!folder || rest.length === 0) continue;
          const entry = voices.get(folder) ?? {
            id: folder,
            hasRecording: false,
            hasConsent: false,
            hasProfile: false,
          };
          const file = rest.join("/");
          if (/^referencia\.(webm|wav|mp3|ogg|m4a)$/i.test(file)) entry.hasRecording = true;
          if (file === "consentimiento.md") entry.hasConsent = true;
          if (file === "perfil.json") entry.hasProfile = true;
          voices.set(folder, entry);
        }
      } catch {
        // A failed listing only hides the voices, never breaks the panel.
      }
      return {
        settings,
        voices: [...voices.values()].sort((a, b) => a.id.localeCompare(b.id)),
        sets: [
          ...ownSets.map((set) => ({ ...set, source: "own" as const })),
          ...(settings.referenceSets ?? []).map((set) => ({ ...set, source: "global" as const })),
        ],
      };
    },
  });
}

async function writeSettings(client: OpenworkServerClient, workspaceId: string, settings: VideoSettings) {
  await client.writeWorkspaceFile(workspaceId, {
    path: SETTINGS_PATH,
    content: `${JSON.stringify({ version: 1, ...settings }, null, 2)}\n`,
  });
}

/** Writes the chosen voice into the project's cue-sheet so the render uses it. */
export async function applyVoiceToProject(
  client: OpenworkServerClient,
  workspaceId: string,
  slug: string,
  voice: string,
): Promise<void> {
  const path = `video-projects/${slug}/cue-sheet.json`;
  const file = await client.readWorkspaceFile(workspaceId, path);
  const cue = readJson<Record<string, unknown>>(file.content);
  const meta = (cue.meta && typeof cue.meta === "object" ? cue.meta : {}) as Record<string, unknown>;
  cue.meta = { ...meta, voice };
  await client.writeWorkspaceFile(workspaceId, {
    path,
    content: `${JSON.stringify(cue, null, 2)}\n`,
  });
}

/** Counts the references already copied into a project. */
export function useProjectReferences(workspace: WorkspaceRef, slug: string | null) {
  const client = workspace.openworkServerClient;
  return useQuery({
    queryKey: ["video-project-references", workspace.workspaceId, slug],
    enabled: Boolean(client && workspace.workspaceId && slug),
    staleTime: 5_000,
    refetchOnWindowFocus: true,
    retry: false,
    queryFn: async (): Promise<{ count: number; names: string[] }> => {
      if (!client || !slug) return { count: 0, names: [] };
      const prefix = `video-projects/${slug}/inspiracion/refs/`;
      const catalog = await client.listWorkspaceFiles(workspace.workspaceId);
      const names = catalog.items
        .filter((item) => item.kind === "file" && item.path.startsWith(prefix))
        .map((item) => item.path.slice(prefix.length));
      return { count: names.length, names };
    },
  });
}

/** "Estudio": the global settings, in one place, for every video. */
export function VideoStudioSettingsDialog({
  open,
  onOpenChange,
  workspace,
  projectSlug,
  projectTitle,
  onAsk,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspace: WorkspaceRef;
  projectSlug: string | null;
  projectTitle: string | null;
  onAsk: (prompt: string) => void;
}) {
  const client = workspace.openworkServerClient;
  const queryClient = useQueryClient();
  const settingsQuery = useVideoStudioSettings(workspace);
  const references = useProjectReferences(workspace, projectSlug);
  const [recorderOpen, setRecorderOpen] = useState(false);
  const [referenceId, setReferenceId] = useState("");
  const [libraryName, setLibraryName] = useState("");
  const libraryInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const referenceInputRef = useRef<HTMLInputElement | null>(null);

  const settings = settingsQuery.data?.settings ?? {};
  const voices = settingsQuery.data?.voices ?? [];
  const sets = settingsQuery.data?.sets ?? [];
  const defaultVoice = settings.voice ?? voices[0]?.id ?? null;
  const readyVoices = useMemo(() => voices.filter((voice) => voice.hasConsent), [voices]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["video-studio-settings", workspace.workspaceId] });
  };

  const chooseVoice = async (voice: string) => {
    if (!client || busy) return;
    setBusy(true);
    try {
      await writeSettings(client, workspace.workspaceId, { ...settings, voice });
      refresh();
      toast.success(`Voz por defecto: ${voice}. Se usa en todos los videos.`);
    } catch (error) {
      toast.error(`No se pudo guardar la voz: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const useVoiceHere = async () => {
    if (!client || !projectSlug || !defaultVoice || busy) return;
    setBusy(true);
    try {
      await applyVoiceToProject(client, workspace.workspaceId, projectSlug, defaultVoice);
      refresh();
      toast.success(`«${projectTitle ?? projectSlug}» ahora usa la voz ${defaultVoice}.`);
    } catch (error) {
      toast.error(`No se pudo aplicar la voz: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const voiceUpload = useMemo(() => {
    if (!client) return null;
    return async (file: File, path: string) => {
      await client.uploadInbox(workspace.workspaceId, file, { path });
    };
  }, [client, workspace.workspaceId]);

  const selectedSet = sets.find((set) => set.id === referenceId);
  const ownLibrary = (selectedSet?.source ?? "own") === "own";

  const applyReferenceSet = () => {
    const id = referenceId.trim();
    if (!id) return;
    if (!projectSlug) {
      toast.error("Elegí un video para aplicarle las referencias.");
      return;
    }
    const library = ownLibrary ? " --library video-library" : "";
    onAsk(
      `En video-projects/${projectSlug}, copiá las referencias del set «${id}» con node .opencode/skills/video-studio/scripts/refs.mjs use${library} --set ${id} --project video-projects/${projectSlug}, y decime cuántas quedaron en inspiracion/refs/. No analices todavía.`,
    );
    onOpenChange(false);
  };

  const listSets = () => {
    onAsk(
      "Corré node .opencode/skills/video-studio/scripts/refs.mjs list y escribí el resultado en video-settings.json, campo referenceSets con [{id, name, refs, measuredAt}]. No cambies ningún otro campo de ese archivo.",
    );
    onOpenChange(false);
  };

  /**
   * Adds videos to the person's own library. The folder is created on the first
   * upload, so another install starts with no references and builds its own.
   */
  const addToLibrary = async (files: FileList | null) => {
    if (!client || !files?.length) return;
    const setId = (libraryName.trim() || "mias").toLowerCase().replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "mias";
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        const safe = file.name.replace(/[^\w.\- ]+/g, "-");
        await client.uploadInbox(workspace.workspaceId, file, {
          path: `${LIBRARY_DIR}/${setId}/${safe}`,
        });
      }
      const catalog = await client.listWorkspaceFiles(workspace.workspaceId);
      const prefix = `${LIBRARY_DIR}/${setId}/`;
      const refs = catalog.items.filter((item) => item.kind === "file" && item.path.startsWith(prefix)).length;
      let current: { version?: number; sets?: Array<Record<string, unknown>> } = { version: 1, sets: [] };
      try {
        const file = await client.readWorkspaceFile(workspace.workspaceId, LIBRARY_CATALOG);
        current = readJson<{ version?: number; sets?: Array<Record<string, unknown>> }>(file.content);
      } catch {
        // First upload: the catalog is created below.
      }
      const nextSets = (current.sets ?? []).filter((set) => set.id !== setId);
      nextSets.push({ id: setId, name: setId, refs, updatedAt: new Date().toISOString().slice(0, 10) });
      await client.writeWorkspaceFile(workspace.workspaceId, {
        path: LIBRARY_CATALOG,
        content: `${JSON.stringify({ version: 1, ...current, sets: nextSets }, null, 2)}\n`,
      });
      setReferenceId(setId);
      refresh();
      toast.success(`${refs} referencias en «${setId}». Ya podés copiarlas a un video.`);
    } catch (error) {
      toast.error(`No se pudo sumar a la biblioteca: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const addReference = async (files: FileList | null) => {
    if (!client || !projectSlug || !files?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        const safe = file.name.replace(/[^\w.\- ]+/g, "-");
        await client.uploadInbox(workspace.workspaceId, file, {
          path: `video-projects/${projectSlug}/inspiracion/refs/${Date.now()}-${safe}`,
        });
      }
      await references.refetch();
      toast.success("Referencias sumadas al video. Pedile al agente que las analice.");
    } catch (error) {
      toast.error(`No se pudo subir la referencia: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Estudio</DialogTitle>
            <DialogDescription>
              Ajustes que valen para todos los videos de {workspace.selectedWorkspaceRoot}.
            </DialogDescription>
          </DialogHeader>

          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">
                <Mic className="size-3.5" /> Voz
              </h3>
              <Button size="xs" variant="outline" onClick={() => setRecorderOpen(true)} disabled={!voiceUpload}>
                Grabar y clonar
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              La voz elegida queda como predeterminada y sirve para todos los videos del workspace.
            </p>
            {settingsQuery.isLoading ? (
              <p className="text-xs text-muted-foreground">Leyendo voces…</p>
            ) : voices.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Todavía no hay voces. Grabá 10–30 s y guardala como perfil.
              </p>
            ) : (
              <ul className="max-h-40 space-y-1 overflow-y-auto">
                {voices.map((voice) => {
                  const selected = voice.id === defaultVoice;
                  return (
                    <li key={voice.id}>
                      <button
                        type="button"
                        onClick={() => void chooseVoice(voice.id)}
                        disabled={busy || !readyVoices.some((entry) => entry.id === voice.id)}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 rounded-lg border px-2 py-1.5 text-left text-[12px]",
                          selected ? "border-foreground/30 bg-muted/60" : "hover:bg-muted/40",
                        )}
                      >
                        <span className="min-w-0 truncate font-medium">{voice.id}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {voice.hasConsent ? (voice.hasProfile ? "lista" : "sin perfil") : "sin consentimiento"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="xs"
                variant="outline"
                onClick={() => void useVoiceHere()}
                disabled={!projectSlug || !defaultVoice || busy}
              >
                Usar en este video
              </Button>
              <span className="text-[11px] text-muted-foreground">
                {projectSlug ? projectTitle ?? projectSlug : "Elegí un video en el panel"}
              </span>
            </div>
          </section>

          <section className="space-y-2 border-t pt-3">
            <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">
              <Users className="size-3.5" /> Referencias
            </h3>
            <p className="text-xs text-muted-foreground">
              Tu biblioteca vive en <code>video-library/</code> de este workspace y se crea sola con la primera
              carga. La lista global es solo un espejo de la de este equipo.
            </p>
            <p className="text-[11px] text-muted-foreground">
              {projectSlug
                ? `En este video: ${references.data?.count ?? 0} referencias en inspiracion/refs/`
                : "Elegí un video para ver sus referencias"}
            </p>
            {sets.length ? (
              <ul className="max-h-40 space-y-1 overflow-y-auto">
                {sets.map((set) => (
                  <li key={`${set.source}:${set.id}`}>
                    <button
                      type="button"
                      onClick={() => setReferenceId(set.id)}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-lg border px-2 py-1.5 text-left text-[12px]",
                        referenceId === set.id ? "border-foreground/30 bg-muted/60" : "hover:bg-muted/40",
                      )}
                    >
                      <span className="min-w-0 truncate">
                        <span className="font-medium">{set.name || set.id}</span>
                        <span className="text-muted-foreground"> · {set.source === "own" ? "propia" : "global"}</span>
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {typeof set.refs === "number" ? `${set.refs} refs` : set.id}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">
                Todavía no hay sets. Sumá videos abajo y quedan en tu biblioteca.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={libraryName}
                onChange={(event) => setLibraryName(event.currentTarget.value)}
                placeholder="carpeta nueva, ej. mias"
                className="h-8 w-44 text-[12px]"
              />
              <Button
                size="xs"
                variant="outline"
                onClick={() => libraryInputRef.current?.click()}
                disabled={busy || !client}
              >
                Sumar a mi biblioteca
              </Button>
              <input
                ref={libraryInputRef}
                type="file"
                accept="video/*"
                multiple
                className="hidden"
                onChange={(event) => void addToLibrary(event.currentTarget.files)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t pt-2">
              <Input
                value={referenceId}
                onChange={(event) => setReferenceId(event.currentTarget.value)}
                placeholder="set a copiar"
                className="h-8 w-44 text-[12px]"
              />
              <Button size="xs" variant="outline" onClick={applyReferenceSet} disabled={!referenceId.trim()}>
                Copiar al proyecto
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => referenceInputRef.current?.click()}
                disabled={!projectSlug || !client}
              >
                Sumar solo a este video
              </Button>
              <Button size="xs" variant="ghost" onClick={listSets}>
                Actualizar lista global
              </Button>
              <input
                ref={referenceInputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(event) => void addReference(event.currentTarget.files)}
              />
            </div>
          </section>

          <section className="space-y-2 border-t pt-3">
            <h3 className="text-[13px] font-semibold">Acciones</h3>
            <p className="text-xs text-muted-foreground">
              Dejan el pedido escrito en el chat del video para que lo revises antes de enviarlo.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="xs" variant="outline" onClick={() => { onAsk(videoActionPrompt("nuevo", { workspaceId: workspace.workspaceId })); onOpenChange(false); }}>
                Nuevo video
              </Button>
              <Button size="xs" variant="outline" onClick={() => { onAsk(videoActionPrompt("analizar")); onOpenChange(false); }}>
                Analizar referencias
              </Button>
              <Button
                size="xs"
                variant="outline"
                onClick={() => { onAsk(videoActionPrompt("renderizar")); onOpenChange(false); }}
              >
                Renderizar
              </Button>
            </div>
          </section>

          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <VideoVoiceRecorder
        open={recorderOpen}
        onOpenChange={setRecorderOpen}
        upload={voiceUpload}
        onSaved={(path) => {
          refresh();
          onAsk(videoVoiceSavedPrompt(path));
          onOpenChange(false);
        }}
      />
    </>
  );
}
