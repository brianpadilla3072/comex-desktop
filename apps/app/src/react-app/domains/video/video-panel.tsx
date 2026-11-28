/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { ArrowLeft, ChevronDown, Copy, ExternalLink, LoaderCircle, MessageSquare, Play, Plus, RefreshCw, Send, Settings2, Sparkles, Trash2, Wrench, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MarkdownBlock } from "@/components/markdown/markdown";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import type { OpenworkServerClient, VideoProjectSummary } from "@/app/lib/openwork-server";
import { DEFAULT_MODEL } from "@/app/constants";
import { getNativeSessionMessages, deleteNativeSession } from "@/app/lib/opencode-session-native";
import { createClient, unwrap } from "@/app/lib/opencode";
import { createClientV2, isOpencodeV2BaseUrl, isOpencodeV2Client } from "@/app/lib/opencode-v2-adapter";
import { useComexVideoStudioEnabled } from "@/react-app/domains/cloud/desktop-config-provider";
import { useWorkspace, useWorkspaceMaybe } from "@/react-app/shell/workspace-provider";
import { readLastSessionFor } from "@/react-app/shell/session-memory";
import { markComposerAutoSend } from "@/react-app/domains/session/surface/composer-auto-send";
import { useComposerStateStore } from "@/react-app/domains/session/surface/composer-state-store";
import { saveSessionDraft } from "@/react-app/domains/session/sync/draft-store";
import { useVideoSessionRegistry } from "@/react-app/domains/video/video-session-registry";
import { videoActionPrompt } from "@/react-app/domains/video/video-actions";
import {
  addPendingVideoRequest,
  listPendingVideoRequests,
  prunePendingVideoRequests,
  removePendingVideoRequest,
  type PendingVideoRequest,
} from "@/react-app/domains/video/video-pending-requests";
import { ModelPickerModal } from "@/react-app/domains/session/modals/model-picker-modal";
import { useModelPicker } from "@/react-app/domains/session/modals/use-model-picker";
import { VideoStudioSettingsDialog } from "@/react-app/domains/video/video-studio-settings";
import { settleQuestionState } from "@/react-app/domains/session/sync/session-sync";
import { workspaceSettingsRoute } from "@/react-app/shell/workspace-routes";
import type { ModelRef } from "@/app/types";

type Workspace = NonNullable<ReturnType<typeof useWorkspaceMaybe>>;
type Project = VideoProjectSummary;
type VideoChatEndpoint = { opencodeBaseUrl: string; token: string };
type VideoModel = { providerID: string; modelID: string; variant?: string | null };
type VideoWorkspaceRef = { id: string; name: string; client: OpenworkServerClient; root: string };
type WorkspaceProjects = { workspaceId: string; name: string; root: string; projects: Project[] };
type ChatTool = { id: string; name: string; target: string; status: string; ms?: number };
type ChatQuestion = { id: string; text: string; options: string[]; answered: boolean };
type VideoQuestionField = {
  header?: string;
  question: string;
  options: Array<{ label: string; description?: string }>;
  multiple: boolean;
};
/** A form the engine is waiting on, with the questions it asks. */
type PendingVideoQuestion = { id: string; sessionID: string; fields: VideoQuestionField[] };
type ChatRow = {
  id: string;
  mine: boolean;
  text: string;
  created: number;
  error?: boolean;
  tools?: ChatTool[];
  question?: ChatQuestion | null;
};
type Style = NonNullable<Project["style"]>;
type Cue = NonNullable<Project["cue"]>;
type Draft = { style: Style; cue: Cue };

const GATES = ["style", "storyboard", "voice", "stills", "final"] as const;
type Gate = (typeof GATES)[number];

function fileUrl(root: string, relative: string): string {
  const full = `${root}/${relative}`.replace(/\\/g, "/").replace(/^\/+/, "");
  return new URL(`file:///${full}`).href;
}

function useProjects(workspace: Workspace) {
  const client = workspace.openworkServerClient;
  return useQuery({
    queryKey: ["video-projects", workspace.workspaceId],
    enabled: Boolean(client && workspace.workspaceId),
    staleTime: 5_000,
    refetchInterval: 4_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<Project[]> => {
      if (!client) return [];
      const result = await client.getVideoProjects(workspace.workspaceId);
      return result.projects;
    },
  });
}

/** Every workspace's videos, grouped, so the panel is not limited to the current one. */
function useAllVideoProjects(refs: VideoWorkspaceRef[] | undefined, currentId: string) {
  const ids = (refs ?? []).map((ref) => ref.id);
  return useQuery({
    queryKey: ["video-projects-all", ids.join(",")],
    enabled: Boolean(ids.length),
    staleTime: 5_000,
    refetchInterval: 6_000,
    refetchOnWindowFocus: true,
    retry: false,
    queryFn: async (): Promise<WorkspaceProjects[]> => {
      const settled = await Promise.allSettled(
        (refs ?? []).map(async (ref) => {
          const projects = (await ref.client.getVideoProjects(ref.id)).projects;
          // The installed server summary has no title; read project.json per project.
          const enriched = await Promise.all(
            projects.slice(0, 20).map(async (project) => {
              if (project.title?.trim() || project.project?.title?.trim()) return project;
              try {
                const file = await ref.client.readWorkspaceFile(
                  ref.id,
                  `video-projects/${project.slug}/project.json`,
                );
                const parsed = JSON.parse(file.content.replace(/^\uFEFF/, "")) as Record<string, unknown>;
                const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
                return title
                  ? { ...project, title, project: { ...(project.project ?? {}), title } }
                  : project;
              } catch {
                return project;
              }
            }),
          );
          return { workspaceId: ref.id, name: ref.name, root: ref.root, projects: enriched };
        }),
      );
      return settled
        .filter((entry): entry is PromiseFulfilledResult<WorkspaceProjects> => entry.status === "fulfilled")
        .map((entry) => entry.value)
        .sort((a, b) =>
          a.workspaceId === currentId ? -1 : b.workspaceId === currentId ? 1 : a.name.localeCompare(b.name),
        );
    },
  });
}

/** File mtimes for the preview: the URL only changes when the file does. */
function useProjectAssetVersions(
  workspace: Workspace,
  slug: string | null,
  hasStill: boolean,
  hasFinal: boolean,
) {
  const client = workspace.openworkServerClient;
  return useQuery({
    queryKey: ["video-assets", workspace.workspaceId, slug],
    enabled: Boolean(client && workspace.workspaceId && slug),
    staleTime: 4_000,
    refetchInterval: 5_000,
    retry: false,
    queryFn: async (): Promise<{ still: number; final: number }> => {
      if (!client || !slug) return { still: 0, final: 0 };
      const stamp = async (path: string) => {
        try {
          const stat = await client.statWorkspaceFile(workspace.workspaceId, path);
          return stat.updatedAt ?? 0;
        } catch {
          return 0;
        }
      };
      const [still, final] = await Promise.all([
        hasStill ? stamp(`video-projects/${slug}/qa/still.png`) : 0,
        hasFinal ? stamp(`video-projects/${slug}/renders/final.mp4`) : 0,
      ]);
      return { still, final };
    },
  });
}

/** Reads `video-projects/<slug>/project.json`: which conversation asked for the video. */
function useProjectOrigin(workspace: Workspace, slug: string | null) {
  const client = workspace.openworkServerClient;
  return useQuery({
    queryKey: ["video-project-origin", workspace.workspaceId, slug],
    enabled: Boolean(client && slug),
    staleTime: 30_000,
    retry: false,
    queryFn: async (): Promise<{
      sessionId?: string;
      title?: string;
      chatSessionId?: string;
      chatModel?: VideoModel;
      raw: Record<string, unknown>;
    } | null> => {
      if (!client || !slug) return null;
      try {
        const file = await client.readWorkspaceFile(workspace.workspaceId, `video-projects/${slug}/project.json`);
        const parsed = JSON.parse(file.content.replace(/^\uFEFF/, "")) as Record<string, unknown>;
        const storedModel = parsed.chatModel;
        const chatModel = storedModel && typeof storedModel === "object"
          && typeof Reflect.get(storedModel, "providerID") === "string"
          && typeof Reflect.get(storedModel, "modelID") === "string"
          ? {
              providerID: Reflect.get(storedModel, "providerID") as string,
              modelID: Reflect.get(storedModel, "modelID") as string,
              variant: typeof Reflect.get(storedModel, "variant") === "string"
                ? (Reflect.get(storedModel, "variant") as string)
                : null,
            }
          : undefined;
        return {
          sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : undefined,
          title: typeof parsed.title === "string" ? parsed.title : undefined,
          chatSessionId: typeof parsed.chatSessionId === "string" ? parsed.chatSessionId : undefined,
          chatModel,
          raw: parsed,
        };
      } catch {
        return null;
      }
    },
  });
}

/**
 * Pins the session to the model the app uses for new tasks. A fresh session has
 * no model, and the engine's own default can be a provider without credit: then
 * the step fails with a quota error and the chat looks like it never answered.
 */
async function applyVideoModel(
  endpoint: VideoChatEndpoint,
  sessionId: string,
  model?: VideoModel,
): Promise<void> {
  if (!model?.providerID || !model.modelID) return;
  if (!isOpencodeV2BaseUrl(endpoint.opencodeBaseUrl)) return;
  const base = endpoint.opencodeBaseUrl.replace(/\/+$/, "");
  try {
    await fetch(`${base}/api/session/${encodeURIComponent(sessionId)}/model`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${endpoint.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: {
          providerID: model.providerID,
          id: model.modelID,
          ...(model.variant ? { variant: model.variant } : {}),
        },
      }),
    });
  } catch {
    // The prompt still goes out; a missing model shows up as a visible error.
  }
}

/** Sends the prompt straight to the video's session, without leaving the panel. */
async function sendVideoPrompt(input: {
  endpoint: VideoChatEndpoint;
  directory: string;
  sessionId: string;
  text: string;
  model?: VideoModel;
}): Promise<void> {
  const { endpoint, sessionId, text, model } = input;
  // The v2 client wrapper refuses to send without an explicit model, but the
  // engine accepts a prompt with the session's own model. Verified against the
  // running engine: POST /api/session/<id>/prompt returns 200 and the assistant
  // replies. Any other base (v1) falls back to the composer flow upstream.
  if (!isOpencodeV2BaseUrl(endpoint.opencodeBaseUrl)) {
    throw new Error("El motor no es v2; se envía desde el chat.");
  }
  const base = endpoint.opencodeBaseUrl.replace(/\/+$/, "");
  await applyVideoModel(endpoint, sessionId, model);
  const response = await fetch(`${base}/api/session/${encodeURIComponent(sessionId)}/prompt`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${endpoint.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ text, delivery: "steer" }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`El motor rechazó el pedido (${response.status})${detail ? `: ${detail.slice(0, 160)}` : ""}.`);
  }
}

/** Whether the engine opened a form the conversation must answer. */
async function engineQuestionPending(endpoint: VideoChatEndpoint, sessionId: string): Promise<boolean> {
  const base = endpoint.opencodeBaseUrl.replace(/\/+$/, "");
  try {
    const response = await fetch(`${base}/api/session/${encodeURIComponent(sessionId)}/form`, {
      headers: { authorization: `Bearer ${endpoint.token}` },
    });
    if (!response.ok) return false;
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) return false;
    return payload.some(
      (item) => Boolean(item) && Reflect.get(item as object, "sessionID") === sessionId,
    );
  } catch {
    return false;
  }
}

/** Waits for an assistant text answer created after `since`. */
async function waitForReply(
  endpoint: VideoChatEndpoint,
  sessionId: string,
  since: number,
  timeoutMs: number,
): Promise<{ answered: boolean; asked?: boolean; error?: string }> {
  const started = Date.now();
  let lastError: string | undefined;
  while (Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    try {
      // A question ends the wait: the agent is not going to write anything
      // until the person answers, and the panel now shows the card to do it.
      if (await engineQuestionPending(endpoint, sessionId)) return { answered: false, asked: true };
      const messages = await getNativeSessionMessages(endpoint, sessionId, { limit: 8 });
      const met = messages.some((message) => {
        const info = message.info as { type?: string; time?: { created?: number } };
        if (info.type !== "assistant") return false;
        if ((info.time?.created ?? 0) < since) return false;
        return messageText(message.parts as ReadonlyArray<unknown>).length > 0;
      });
      if (met) return { answered: true };
      const failed = messages.find((message) => {
        const info = message.info as {
          role?: string;
          time?: { created?: number };
          finish?: string;
          error?: { message?: string; name?: string; type?: string };
        };
        if (info.role !== "assistant") return false;
        if ((info.time?.created ?? 0) < since) return false;
        return Boolean(info.error?.message || info.error?.name || info.error?.type || info.finish === "error");
      });
      if (failed) {
        const info = failed.info as { error?: { message?: string; name?: string; type?: string } };
        lastError = info.error?.message || info.error?.type || info.error?.name || "error sin detalle";
        // An abort is the person stopping the step, not a broken model: wait on.
        if (!/aborted|interrupted/i.test(lastError)) return { answered: false, error: lastError };
      }
    } catch {
      // Keep waiting: a transient read failure is not a verdict.
    }
  }
  return { answered: false, error: lastError };
}

/**
 * Creates the session that belongs to the video, so its chat no longer depends
 * on the conversation that asked for it. Returns the new session id.
 */
async function createVideoChatSession(input: {
  endpoint: VideoChatEndpoint;
  directory: string;
  title: string;
  model?: VideoModel;
}): Promise<string> {
  const { endpoint, directory, title, model } = input;
  const client = isOpencodeV2BaseUrl(endpoint.opencodeBaseUrl)
    ? createClientV2(endpoint.opencodeBaseUrl, directory, { token: endpoint.token })
    : createClient(endpoint.opencodeBaseUrl, undefined, { token: endpoint.token, mode: "openwork" });
  const session = unwrap(await client.session.create({ directory }) as never) as { id?: string };
  const id = session?.id;
  if (!id) throw new Error("El motor no devolvió el id de la sesión.");
  await applyVideoModel(endpoint, id, model);
  try {
    const update = (client.session as unknown as {
      update?: (input: { sessionID: string; title: string }) => Promise<unknown>;
    }).update;
    if (update) await update({ sessionID: id, title });
  } catch {
    // The title is cosmetic; the session works without it.
  }
  return id;
}

/** Recent messages of the conversation that owns the video, shown beside it. */
function useVideoChat(endpoint: VideoChatEndpoint | undefined, sessionId: string | undefined) {
  return useQuery({
    queryKey: ["video-chat", sessionId, endpoint?.opencodeBaseUrl],
    enabled: Boolean(endpoint?.token && sessionId),
    staleTime: 5_000,
    refetchInterval: 3_000,
    retry: false,
    queryFn: async () => {
      if (!endpoint || !sessionId) return [];
      return getNativeSessionMessages(endpoint, sessionId, { limit: 200 });
    },
  });
}

/** A client for the engine that owns this video's conversation. */
function videoEngineClient(endpoint: VideoChatEndpoint | undefined, directory: string | undefined) {
  if (!endpoint?.token) return null;
  return isOpencodeV2BaseUrl(endpoint.opencodeBaseUrl)
    ? createClientV2(endpoint.opencodeBaseUrl, directory || undefined, { token: endpoint.token })
    : createClient(endpoint.opencodeBaseUrl, directory || undefined, { token: endpoint.token, mode: "openwork" });
}

type EngineQuestion = {
  id?: string;
  sessionID?: string;
  questions?: Array<{
    header?: string;
    question?: string;
    options?: Array<{ label?: string; description?: string }>;
    multiple?: boolean;
  }>;
};

/**
 * The question the engine opened for this conversation, with its options. A
 * form for another session, or one without a real question, is ignored.
 */
export function videoQuestionFromEngine(
  item: EngineQuestion,
  sessionId: string,
): PendingVideoQuestion | null {
  const id = typeof item.id === "string" ? item.id : "";
  if (!id || item.sessionID !== sessionId) return null;
  const fields = (item.questions ?? []).flatMap((field): VideoQuestionField[] => {
    const question = typeof field.question === "string" ? field.question.trim() : "";
    if (!question) return [];
    const options = (field.options ?? []).flatMap((option) =>
      typeof option.label === "string" && option.label.trim()
        ? [{
          label: option.label,
          ...(typeof option.description === "string" && option.description.trim()
            ? { description: option.description }
            : {}),
        }]
        : []);
    return [{ header: field.header, question, options, multiple: Boolean(field.multiple) }];
  });
  if (!fields.length) return null;
  return { id, sessionID: item.sessionID ?? sessionId, fields };
}

/**
 * The questions this conversation is waiting on. A `question` tool call is not
 * enough: the reply goes to the form the engine opened, so the panel reads the
 * pending forms instead of guessing from the message history.
 */
function useVideoQuestions(
  endpoint: VideoChatEndpoint | undefined,
  directory: string | undefined,
  sessionId: string | undefined,
  active: boolean,
) {
  const client = useMemo(
    () => videoEngineClient(endpoint, directory),
    [endpoint?.token, endpoint?.opencodeBaseUrl, directory],
  );
  const query = useQuery({
    queryKey: ["video-questions", endpoint?.opencodeBaseUrl ?? "", directory ?? "", sessionId ?? ""],
    enabled: Boolean(client && sessionId),
    // Faster while the agent works: the question shows up right when it asks.
    refetchInterval: active ? 1_500 : 6_000,
    retry: false,
    queryFn: async (): Promise<PendingVideoQuestion[]> => {
      if (!client || !sessionId) return [];
      const items = unwrap(await client.question.list({ directory })) as unknown as EngineQuestion[];
      return items.flatMap((item) => {
        const question = videoQuestionFromEngine(item, sessionId);
        return question ? [question] : [];
      });
    },
  });
  return { ...query, client };
}

/** Only the readable text of a message; tool calls and attachments are skipped. */
function messageText(parts: ReadonlyArray<unknown>): string {
  const chunks: string[] = [];
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    if (Reflect.get(part, "type") !== "text") continue;
    const text = Reflect.get(part, "text");
    if (typeof text === "string" && text.trim()) chunks.push(text.trim());
  }
  return chunks.join("\n\n");
}

/** Qué tocó la herramienta, en una línea: comando, archivo, patrón o URL. */
function toolTarget(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const pick = (key: string) => {
    const value = Reflect.get(input, key);
    return typeof value === "string" ? value : "";
  };
  const raw = pick("command") || pick("filePath") || pick("path") || pick("pattern")
    || pick("query") || pick("url") || pick("cmd") || pick("description");
  const first = raw.split(/\r?\n/)[0]?.trim() ?? "";
  return first.length > 64 ? `${first.slice(0, 61)}…` : first;
}

/** Las llamadas a herramientas del mensaje, para mostrar qué está haciendo. */
function messageTools(parts: ReadonlyArray<unknown>): ChatTool[] {
  const tools: ChatTool[] = [];
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    if (Reflect.get(part, "type") !== "tool") continue;
    const name = String(Reflect.get(part, "name") ?? "herramienta");
    const state = Reflect.get(part, "state");
    const status = state && typeof state === "object"
      ? String(Reflect.get(state, "status") ?? "")
      : "";
    const input = state && typeof state === "object" ? Reflect.get(state, "input") : undefined;
    const time = Reflect.get(part, "time");
    const created = time && typeof time === "object" ? Number(Reflect.get(time, "created") ?? 0) : 0;
    const completed = time && typeof time === "object" ? Number(Reflect.get(time, "completed") ?? 0) : 0;
    tools.push({
      id: String(Reflect.get(part, "id") ?? `${name}-${tools.length}`),
      name,
      target: toolTarget(input),
      status,
      ...(completed && created ? { ms: completed - created } : {}),
    });
  }
  return tools;
}

/** La pregunta que el agente dejó abierta, con sus opciones, si la hay. */
function messageQuestion(parts: ReadonlyArray<unknown>): ChatQuestion | null {
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    if (Reflect.get(part, "type") !== "tool") continue;
    if (Reflect.get(part, "name") !== "question") continue;
    const state = Reflect.get(part, "state");
    if (!state || typeof state !== "object") continue;
    const input = Reflect.get(state, "input");
    const questions = input && typeof input === "object" ? Reflect.get(input, "questions") : null;
    if (!Array.isArray(questions) || questions.length === 0) continue;
    const first = questions[0];
    if (!first || typeof first !== "object") continue;
    const text = Reflect.get(first, "question");
    const rawOptions = Reflect.get(first, "options");
    const options = Array.isArray(rawOptions)
      ? rawOptions.flatMap((option) => {
        const label = option && typeof option === "object" ? Reflect.get(option, "label") : null;
        return typeof label === "string" && label.trim() ? [label] : [];
      })
      : [];
    return {
      id: String(Reflect.get(part, "id") ?? "question"),
      text: typeof text === "string" ? text : "",
      options,
      answered: String(Reflect.get(state, "status") ?? "") === "completed",
    };
  }
  return null;
}

/** Un slug sin título se lee mejor con espacios y mayúscula inicial. */
function humanizeVideoSlug(slug: string): string {
  const spaced = slug.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : slug;
}

/** El nombre que ve la persona: el guardado, o uno legible sacado del slug. */
export function videoTitle(project: Project): string {
  const stored = typeof project.title === "string" ? project.title.trim() : "";
  const fromProject = project.project?.title?.trim() ?? "";
  return stored || fromProject || humanizeVideoSlug(project.slug);
}

/** mm:ss para la tira de escenas y el preview. */
export function clockTime(seconds: number): string {
  const safe = Number.isFinite(seconds) ? seconds : 0;
  const total = Math.max(0, Math.round(safe));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Palabras por segundo: arriba de ~3,2 el texto no entra en su tiempo. */
export function beatWordsPerSecond(text: string, duration: number): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (!words) return 0;
  return words / Math.max(0.5, duration);
}

/** Primer segundo que menciona un aviso del QA («… a los 12,4 s»). */
export function secondsFromDetail(detail: string): number | null {
  const match = detail.match(/(\d+(?:[.,]\d+)?)\s*(?:s|seg|segundos)\b/i);
  if (!match) return null;
  return Number(match[1].replace(",", "."));
}

function gateReady(project: Project, gate: Gate): boolean {
  switch (gate) {
    case "style":
      return Array.isArray(project.style?.palette) && project.style.palette.length > 0;
    case "storyboard":
      return project.hasStoryboard && Array.isArray(project.cue?.beats) && project.cue.beats.length > 0;
    case "voice":
      return Boolean(project.cue?.beats?.some((beat) => beat.voice?.audio && beat.voice?.line));
    case "stills":
      return project.hasStill;
    case "final":
      return project.hasFinal;
  }
}

/** «hace 2 h», «ayer», «hace 4 días»: cuánto pasó desde la última modificación. */
function relativeTime(ms?: number | null): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "recién";
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? "ayer" : `hace ${days} días`;
}

function OptionToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-[13px]">
      <Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} />
      {label}
    </label>
  );
}

export function VideoRoute() {
  const enabled = useComexVideoStudioEnabled();
  const workspace = useWorkspaceMaybe();
  if (!enabled) return <Navigate to="/session" replace />;
  if (!workspace?.workspaceId) {
    return <div className="p-8 text-sm text-muted-foreground">Abrí un workspace para ver sus videos.</div>;
  }
  return <VideoPanel workspace={workspace} />;
}

export function VideoPanelRoute({
  endpoint,
  workspaces,
  draftScope,
  model,
}: {
  endpoint?: VideoChatEndpoint;
  workspaces?: VideoWorkspaceRef[];
  draftScope?: string | null;
  model?: VideoModel;
}) {
  const workspace = useWorkspace();
  return (
    <VideoPanel
      workspace={workspace}
      endpoint={endpoint}
      workspaces={workspaces}
      draftScope={draftScope}
      model={model}
    />
  );
}

export function VideoPanel({
  workspace,
  endpoint,
  workspaces,
  draftScope,
  model,
}: {
  workspace: Workspace;
  endpoint?: VideoChatEndpoint;
  workspaces?: VideoWorkspaceRef[];
  draftScope?: string | null;
  model?: VideoModel;
}) {
  const projects = useProjects(workspace);
  const allProjects = useAllVideoProjects(workspaces, workspace.workspaceId);
  const allGroups = useMemo<WorkspaceProjects[]>(() => {
    const fromAll = (allProjects.data ?? []).filter((group) => group.projects.length > 0);
    if (fromAll.length) return fromAll;
    const local = projects.data ?? [];
    return local.length
      ? [{ workspaceId: workspace.workspaceId, name: "", root: workspace.selectedWorkspaceRoot, projects: local }]
      : [];
  }, [allProjects.data, projects.data, workspace.workspaceId]);
  // A request stops being pending once its conversation created the project.
  useEffect(() => {
    const known = allGroups.flatMap((group) =>
      group.projects.flatMap((project) => (project.project?.sessionId ? [project.project.sessionId] : [])),
    );
    if (known.length === 0) return;
    setPending(prunePendingVideoRequests(known));
  }, [allGroups]);
  const [searchParams] = useSearchParams();
  const [selectedSlug, setSelectedSlug] = useState<string | null>(() => searchParams.get("project"));
  // El centro arranca en «Recientes»; si la URL trae ?project=, abre ese video.
  const [view, setView] = useState<"recent" | "project">(
    () => (searchParams.get("project") ? "project" : "recent"),
  );
  const recent = useMemo(
    () =>
      allGroups
        .flatMap((group) => group.projects.map((project) => ({ group, project })))
        .sort((a, b) => (b.project.updatedAt ?? 0) - (a.project.updatedAt ?? 0)),
    [allGroups],
  );
  // Una sola lista por actividad: buscar por título, carpeta o workspace.
  const [listQuery, setListQuery] = useState("");
  const [workspaceFilter, setWorkspaceFilter] = useState<string>("all");
  const listEntries = useMemo(() => {
    const query = listQuery.trim().toLowerCase();
    return recent.filter(({ group, project }) => {
      if (workspaceFilter !== "all" && group.workspaceId !== workspaceFilter) return false;
      if (!query) return true;
      return `${videoTitle(project)} ${project.slug} ${group.name}`.toLowerCase().includes(query);
    });
  }, [recent, listQuery, workspaceFilter]);
  const openProject = (group: WorkspaceProjects, slug: string) => {
    if (group.workspaceId !== workspace.workspaceId) {
      window.location.hash = `#/workspace/${group.workspaceId}/video?project=${encodeURIComponent(slug)}`;
      return;
    }
    setSelectedSlug(slug);
    setView("project");
  };
  const [draft, setDraft] = useState<Draft | null>(null);
  const [previewSecond, setPreviewSecond] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const client = workspace.openworkServerClient;

  const selected = useMemo(() => {
    const list = projects.data ?? [];
    return list.find((project) => project.slug === selectedSlug) ?? list[0] ?? null;
  }, [projects.data, selectedSlug]);

  const selectedSlugKey = selected?.slug ?? null;

  useEffect(() => {
    if (!selected) {
      setDraft(null);
      return;
    }
    setDraft({
      style: structuredClone(selected.style ?? {}),
      cue: structuredClone(selected.cue ?? {}),
    });
    setPreviewSecond(0);
    // The draft resets only when switching projects, not on every refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSlugKey]);

  const options = draft?.style.options ?? {};
  const effectiveAspect = draft?.style.format?.aspect ?? selected?.cue?.meta?.aspect ?? "9:16";
  // El preview se recorta al formato elegido sin salirse del alto disponible.
  const aspectParts = effectiveAspect.split(":").map(Number);
  const previewRatio = (aspectParts[0] ?? 0) > 0 && (aspectParts[1] ?? 0) > 0
    ? aspectParts[0] / aspectParts[1]
    : 9 / 16;

  // A draft that differs from what is on disk is easy to lose: switching videos
  // resets it silently. Track it and ask before dropping the edits.
  const savedSnapshot = useMemo(
    () => JSON.stringify({ style: selected?.style ?? {}, cue: selected?.cue ?? {} }),
    [selected],
  );
  const dirty = draft && selected
    ? JSON.stringify({ style: draft.style ?? {}, cue: draft.cue ?? {} }) !== savedSnapshot
    : false;
  const beats = draft?.cue.beats ?? [];
  // El beat que suena en el preview se resalta en la tira de escenas.
  const currentBeat = beats.findIndex(
    (beat, index) => previewSecond >= beat.time
      && (index === beats.length - 1 || previewSecond < (beats[index + 1]?.time ?? Number.POSITIVE_INFINITY)),
  );
  const renderMinutes = Math.ceil(
    (((draft?.cue.meta?.durationSeconds ?? 0) * (draft?.cue.meta?.fps ?? 30)) / 300),
  );
  const qaIssues = (selected?.report?.checks ?? []).filter((check) => !check.ok);
  const seekPreview = (seconds: number) => {
    const node = videoRef.current;
    if (node) {
      node.currentTime = Math.max(0, seconds);
      void node.play().catch(() => {});
    }
    setPreviewSecond(Math.max(0, seconds));
  };
  const confirmDiscard = () =>
    !dirty || window.confirm("Tenés cambios sin guardar en este video. Si seguís, se descartan.");

  const refetch = () => {
    void projects.refetch();
    void allProjects.refetch();
  };
  // Browser caches file:// URLs by path; the mtime makes the URL change only
  // when the file really changed, so the preview stops flashing on every poll.
  const assets = useProjectAssetVersions(
    workspace,
    selected?.slug ?? null,
    Boolean(selected?.hasStill),
    Boolean(selected?.hasFinal),
  );
  const previewStillVersion = assets.data?.still ?? 0;
  const previewFinalVersion = assets.data?.final ?? 0;
  // Thumbnails are tiny; a slow rotation keeps them current without churn.
  const thumbVersion = Math.floor(allProjects.dataUpdatedAt / 60_000);

  const patchStyle = (patch: Partial<Style>) => {
    setDraft((current) => (current ? { ...current, style: { ...current.style, ...patch } } : current));
  };

  const patchOptions = (patch: Partial<NonNullable<Style["options"]>>) => {
    if (!draft) return;
    patchStyle({ options: { ...(draft.style.options ?? {}), ...patch } });
  };

  const patchFormat = (patch: Partial<NonNullable<Style["format"]>>) => {
    if (!draft) return;
    patchStyle({ format: { ...(draft.style.format ?? {}), ...patch } });
  };

  /** Editar el texto de una escena reescribe el cue-sheet al guardar. */
  const patchBeat = (index: number, patch: Partial<NonNullable<Cue["beats"]>[number]>) => {
    setDraft((current) => {
      if (!current) return current;
      const list = [...(current.cue.beats ?? [])];
      const beat = list[index];
      if (!beat) return current;
      list[index] = { ...beat, ...patch };
      return { ...current, cue: { ...current.cue, beats: list } };
    });
  };

  const saveEdits = async (): Promise<boolean> => {
    if (!client || !selected || !draft) return false;
    try {
      await client.writeWorkspaceFile(workspace.workspaceId, {
        path: `video-projects/${selected.slug}/cue-sheet.json`,
        content: `${JSON.stringify(draft.cue, null, 2)}\n`,
      });
      await client.writeWorkspaceFile(workspace.workspaceId, {
        path: `video-projects/${selected.slug}/style.json`,
        content: `${JSON.stringify(draft.style, null, 2)}\n`,
      });
      toast.success("Opciones guardadas. Pedí el render para verlas aplicadas.");
      refetch();
      return true;
    } catch {
      toast.error("No se pudieron guardar las opciones.");
      return false;
    }
  };

  const copyPrompt = async (prompt: string) => {
    try {
      await navigator.clipboard.writeText(prompt);
      toast.success("Pedido copiado. Pegalo en el chat.");
    } catch {
      toast.error("No se pudo copiar el pedido.");
    }
  };

  const renderPrompt = (slug: string) =>
    `En video-projects/${slug}, renderizá de nuevo con video-studio usando style.json y cue-sheet.json actuales; actualizá renders/final.mp4 y corré render_qa.`;

  /** Saves the options and sends the render request to this video's own chat. */
  const saveAndRender = async () => {
    if (!selected) return;
    const saved = await saveEdits();
    if (!saved) return;
    setChatOpen(true);
    await sendChangeRequest({ text: renderPrompt(selected.slug), mode: "raw" });
  };

  /** Returns to the conversation the person had open, not to a blank chat. */
  const backToChat = () => {
    const workspaceId = workspace.workspaceId;
    if (!workspaceId) {
      window.location.hash = "#/session";
      return;
    }
    const remembered = readLastSessionFor(workspaceId);
    window.location.hash = remembered
      ? `#/workspace/${workspaceId}/session/${remembered}`
      : `#/workspace/${workspaceId}/session`;
  };

  const origin = useProjectOrigin(workspace, selected?.slug ?? null);
  const queryClient = useQueryClient();
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatNote, setChatNote] = useState<string | null>(null);
  // Answering the agent's question from the panel: picks per question field,
  // a free-text answer, and the request being answered.
  const [questionPicks, setQuestionPicks] = useState<string[][]>([]);
  const [questionText, setQuestionText] = useState("");
  const [questionBusy, setQuestionBusy] = useState<string | null>(null);
  const [questionError, setQuestionError] = useState<string | null>(null);
  const activeChatSessionId = chatSessionId ?? origin.data?.chatSessionId ?? undefined;
  const chat = useVideoChat(endpoint, activeChatSessionId);
  // The model belongs to this video, not to the workspace: it is saved in its
  // project.json and pinned to its session before every send.
  const modelPicker = useModelPicker({
    client: workspace.client,
    baseUrl: endpoint?.opencodeBaseUrl || workspace.opencodeBaseUrl,
    workspaceRoot: workspace.selectedWorkspaceRoot,
  });
  const chatModel = useMemo<VideoModel>(() => {
    if (origin.data?.chatModel) return origin.data.chatModel;
    if (model?.providerID && model.modelID) {
      return { providerID: model.providerID, modelID: model.modelID, variant: model.variant ?? null };
    }
    return { providerID: DEFAULT_MODEL.providerID, modelID: DEFAULT_MODEL.modelID, variant: null };
  }, [origin.data?.chatModel, model?.providerID, model?.modelID, model?.variant]);
  const chatModelIsExplicit = Boolean(origin.data?.chatModel);
  const chatRows = useMemo<ChatRow[]>(() => {
    const rows: ChatRow[] = [];
    for (const message of chat.data ?? []) {
      const info = message.info as {
        id?: string;
        role?: string;
        time?: { created?: number };
        finish?: string;
        error?: { type?: string; name?: string; message?: string } | string;
      };
      const text = messageText(message.parts as ReadonlyArray<unknown>);
      const tools = messageTools(message.parts as ReadonlyArray<unknown>);
      const question = messageQuestion(message.parts as ReadonlyArray<unknown>);
      const created = info.time?.created ?? 0;
      if (!text) {
        // A failed or stopped assistant step has no text at all. Without this the
        // chat looks silent even though the engine reported a reason.
        const failure = typeof info.error === "string"
          ? info.error
          : info.error?.message || info.error?.type || info.error?.name;
        if (info.role === "assistant" && (failure || info.finish === "error")) {
          rows.push({
            id: `${info.id ?? `row-${rows.length}`}:error`,
            mine: false,
            text: `El motor no respondió: ${failure || "error sin detalle"}`,
            created,
            error: true,
            tools,
          });
          continue;
        }
        // A step that only called tools (as when it asks a question) used to be
        // dropped here, so the chat looked stuck and the tool trail vanished.
        if (info.role === "assistant" && (tools.length > 0 || question)) {
          rows.push({
            id: info.id ?? `row-${rows.length}`,
            mine: false,
            text: "",
            created,
            tools,
            question,
          });
        }
        continue;
      }
      rows.push({
        id: info.id ?? `row-${rows.length}`,
        mine: info.role === "user",
        text,
        created,
        tools,
        question,
      });
    }
    // The engine returns newest first; a chat reads oldest first.
    return rows.sort((a, b) => a.created - b.created);
  }, [chat.data]);
  // The last word is the person's: the agent is working on it.
  const lastRow = chatRows[chatRows.length - 1];
  // A step with a tool still running is also work in progress, even when the
  // assistant already wrote something (or only called tools).
  const runningTool = lastRow?.tools?.find((tool) => tool.status && tool.status !== "completed");
  const chatPending = Boolean(lastRow && (lastRow.mine || runningTool));
  // The engine waits on a form, not on a message: read the pending ones.
  const questions = useVideoQuestions(
    endpoint,
    workspace.selectedWorkspaceRoot,
    activeChatSessionId,
    chatPending,
  );
  const pendingQuestion = questions.data?.[0] ?? null;
  // A new question starts clean: no picks or text from the previous one.
  useEffect(() => {
    setQuestionPicks([]);
    setQuestionText("");
    setQuestionError(null);
  }, [pendingQuestion?.id]);
  // Mientras trabaja, el panel cuenta cuánto hace que empezó y qué herramienta corre.
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (!chatPending) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [chatPending]);
  const chatElapsed = lastRow ? Math.max(0, Math.round((clock - lastRow.created) / 1000)) : 0;
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = chatScrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [chatRows, chatPending]);
  const [changeRequest, setChangeRequest] = useState("");
  // A prompt written by the panel itself (Estudio, acciones de video) is sent
  // as is; what the person types is scoped to the selected project.
  const [changeRequestMode, setChangeRequestMode] = useState<"project" | "raw">("project");
  const [studioOpen, setStudioOpen] = useState(false);
  // The chat lives in a drawer below xl, where the three-column layout does not
  // fit; the same panel stays fixed on wide screens.
  const [chatOpen, setChatOpen] = useState(false);
  const [newVideoOpen, setNewVideoOpen] = useState(false);
  const [newVideoText, setNewVideoText] = useState("");
  const [newVideoBusy, setNewVideoBusy] = useState(false);
  // Requests sent from the panel whose project.json does not exist yet.
  const [pending, setPending] = useState<PendingVideoRequest[]>(() => listPendingVideoRequests());
  const changeRequestRef = useRef<HTMLTextAreaElement | null>(null);
  const navigate = useNavigate();
  const hideVideoSession = useVideoSessionRegistry((state) => state.hide);
  const showVideoSession = useVideoSessionRegistry((state) => state.show);

  // Existing video chats are hidden from the sidebar too, not only new ones.
  useEffect(() => {
    const id = origin.data?.chatSessionId;
    if (id) hideVideoSession(id);
  }, [origin.data?.chatSessionId, hideVideoSession]);

  // A project switch starts a fresh chat for that video.
  useEffect(() => {
    setChatSessionId(null);
    setChatError(null);
    setChatNote(null);
  }, [selected?.slug]);

  const persistChatSessionId = async (slug: string, id: string | null) => {
    const client = workspace.openworkServerClient;
    if (!client) return;
    const next: Record<string, unknown> = { ...(origin.data?.raw ?? {}) };
    if (id) next.chatSessionId = id;
    else delete next.chatSessionId;
    await client.writeWorkspaceFile(workspace.workspaceId, {
      path: `video-projects/${slug}/project.json`,
      content: `${JSON.stringify(next, null, 2)}\n`,
    });
    void queryClient.invalidateQueries({ queryKey: ["video-project-origin", workspace.workspaceId, slug] });
    void queryClient.invalidateQueries({ queryKey: ["video-projects-linked"] });
  };

  /** Saves the model chosen for this video; null removes the choice. */
  const persistChatModel = async (slug: string, value: VideoModel | null) => {
    const client = workspace.openworkServerClient;
    if (!client) return;
    const next: Record<string, unknown> = { ...(origin.data?.raw ?? {}) };
    if (value) {
      next.chatModel = {
        providerID: value.providerID,
        modelID: value.modelID,
        ...(value.variant ? { variant: value.variant } : {}),
      };
    } else {
      delete next.chatModel;
    }
    await client.writeWorkspaceFile(workspace.workspaceId, {
      path: `video-projects/${slug}/project.json`,
      content: `${JSON.stringify(next, null, 2)}\n`,
    });
    void queryClient.invalidateQueries({ queryKey: ["video-project-origin", workspace.workspaceId, slug] });
  };

  /** Applies the choice right away, so the next prompt uses it without waiting. */
  const selectChatModel = async (next: ModelRef) => {
    modelPicker.setOpen(false);
    if (!selected) return;
    const value: VideoModel = { providerID: next.providerID, modelID: next.modelID, variant: null };
    setChatNote(null);
    try {
      await persistChatModel(selected.slug, value);
      if (endpoint && activeChatSessionId) {
        await applyVideoModel(endpoint, activeChatSessionId, value);
      }
    } catch (error) {
      setChatError(`No se pudo guardar el modelo del video: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /**
   * Sends the request to the video's own conversation. The first request creates
   * that session and links it in `project.json`, so the chat stops depending on
   * whoever asked for the video.
   *
   * The panel's own buttons pass the text they prepared, so a request the panel
   * can build never goes through the clipboard.
   */
  const sendChangeRequest = async (override?: { text: string; mode: "project" | "raw" }) => {
    const text = (override?.text ?? changeRequest).trim();
    const mode = override?.mode ?? changeRequestMode;
    if (!text || !selected || chatBusy) return;
    setChatBusy(true);
    setChatError(null);
    setChatNote(null);
    try {
      const title = origin.data?.title?.trim() || videoTitle(selected);
      let sessionId = activeChatSessionId;
      if (!sessionId) {
        if (!endpoint) throw new Error("Falta el motor del workspace para crear la conversación.");
        sessionId = await createVideoChatSession({
          endpoint,
          directory: workspace.selectedWorkspaceRoot,
          title,
          model: chatModel,
        });
        await persistChatSessionId(selected.slug, sessionId);
        setChatSessionId(sessionId);
        hideVideoSession(sessionId);
        // Sin project.json no hay conversación de origen: la del panel es nueva
        // y conviene decirlo, en vez de que aparezca un chat con otro nombre.
        setChatNote("Este video no tenía conversación propia: se creó una nueva para este pedido.");
      }
      const prompt = mode === "raw"
        ? text
        : [
            `En video-projects/${selected.slug} (video «${title}»): ${text}`,
            "",
            "Mantené el estilo y las opciones actuales. Si el cambio afecta el resultado, mostrame los stills antes del render final.",
            "Si el pedido admite más de una interpretación, preguntá con opciones usando la herramienta question antes de elegir por tu cuenta: la pregunta se contesta en el panel.",
          ].join("\n");
      if (endpoint) {
        try {
          const since = Date.now();
          await sendVideoPrompt({
            endpoint,
            directory: workspace.selectedWorkspaceRoot,
            sessionId,
            text: prompt,
            model: chatModel,
          });
          if (!override) {
            setChangeRequest("");
            setChangeRequestMode("project");
          }
          void chat.refetch();
          // The engine accepts the prompt immediately; the answer takes longer.
          // Confirm a text answer and, if it never arrives, say so instead of
          // leaving the panel looking dead.
          const first = await waitForReply(endpoint, sessionId, since - 1_000, 12_000);
          if (first.answered) {
            void chat.refetch();
            return;
          }
          if (first.asked) {
            // The card below the messages answers it; what comes next depends
            // on that answer, so this request is done for now.
            void chat.refetch();
            void questions.refetch();
            return;
          }
          // A quota or credit failure is not the person's fault and blocks every
          // send. The app's default model can be out of credit, so retry once on
          // the free default and say which model answered.
          const blockedByProvider = Boolean(first.error)
            && /quota|credit|balance|limit|payment|unauthor|401|402|429/i.test(first.error ?? "");
          if (blockedByProvider && !chatModelIsExplicit) {
            const retrySince = Date.now();
            await sendVideoPrompt({
              endpoint,
              directory: workspace.selectedWorkspaceRoot,
              sessionId,
              text: prompt,
              model: { providerID: DEFAULT_MODEL.providerID, modelID: DEFAULT_MODEL.modelID },
            });
            const retry = await waitForReply(endpoint, sessionId, retrySince - 1_000, 15_000);
            void chat.refetch();
            setChatNote(
              retry.answered
                ? `El modelo de la app no tenía saldo (${first.error}). Respondió con el modelo gratuito ${DEFAULT_MODEL.providerID}/${DEFAULT_MODEL.modelID}.`
                : `El modelo de la app no tenía saldo (${first.error}) y el gratuito tampoco respondió. Elegí otro modelo para este video en el selector.`,
            );
            return;
          }
          if (blockedByProvider) {
            // An explicit choice is respected: switching models behind the
            // person's back would be worse than telling them it failed.
            void chat.refetch();
            setChatNote(
              `El modelo elegido (${chatModel.providerID}/${chatModel.modelID}) no pudo responder: ${first.error}. Elegí otro modelo para este video en el selector.`,
            );
            return;
          }
          void chat.refetch();
          setChatNote(
            first.error
              ? `El motor devolvió un error: ${first.error}`
              : "El pedido se envió. El agente todavía no devolvió texto: puede estar trabajando. Si en un rato no aparece nada, enviá otra vez o reiniciá la conversación con la papelera.",
          );
          return;
        } catch (error) {
          // The direct call skips the app's system context; if the engine refuses,
          // fall back to the composer flow, which builds it.
          setChatError(
            `No se pudo enviar directo (${error instanceof Error ? error.message : "error"}). Lo mando desde el chat del workspace.`,
          );
        }
      }
      // Persist the draft first: the composer loads it from storage when the
      // session mounts, and only then the auto-send has something to send.
      saveSessionDraft(draftScope, workspace.workspaceId, sessionId, { text: prompt, mode: "prompt" });
      useComposerStateStore.getState().setDraft(sessionId, prompt);
      markComposerAutoSend(sessionId);
      if (!override) {
        setChangeRequest("");
        setChangeRequestMode("project");
      }
      navigate(`/workspace/${workspace.workspaceId}/session/${sessionId}`);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : String(error));
    } finally {
      setChatBusy(false);
    }
  };

  /** Writes a request the panel already prepared; the person reviews and sends. */
  const askAgent = (text: string) => {
    setChangeRequest(text);
    setChangeRequestMode("raw");
    setChatError(null);
    setChatNote(null);
    window.requestAnimationFrame(() => {
      changeRequestRef.current?.focus();
      changeRequestRef.current?.setSelectionRange(text.length, text.length);
    });
  };

  /** Deletes only the video's conversation; the project and its files stay. */
  const deleteChatSession = async () => {
    const sessionId = activeChatSessionId;
    if (!sessionId || !selected || !endpoint || chatBusy) return;
    if (!window.confirm("Se borra la conversación de este video. El video y sus archivos no se tocan. ¿Seguir?")) return;
    setChatBusy(true);
    setChatError(null);
    try {
      await deleteNativeSession(endpoint, sessionId);
      await persistChatSessionId(selected.slug, null);
      // Deleting the chat brings the record out of the hidden list.
      showVideoSession(sessionId);
      setChatSessionId(null);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : String(error));
    } finally {
      setChatBusy(false);
    }
  };

  /**
   * Starts a new video from the panel: the idea becomes the first message of a
   * new conversation, which is where video-studio creates the project. Sending
   * from the composer keeps the app's system context, which a direct call skips.
   */
  const startNewVideo = async () => {
    const idea = newVideoText.trim();
    if (!idea || newVideoBusy) return;
    if (!endpoint) {
      toast.error("Falta el motor del workspace para crear la conversación.");
      return;
    }
    setNewVideoBusy(true);
    try {
      const sessionId = await createVideoChatSession({
        endpoint,
        directory: workspace.selectedWorkspaceRoot,
        title: idea.slice(0, 60),
        model: chatModel,
      });
      // The same prompt the composer's + menu uses: it tells the agent to create
      // video-projects/<slug>/project.json, which is what makes the video appear
      // here. Without it the agent only answers with text and nothing is listed.
      const prompt = [
        `Mi pedido: ${idea}`,
        videoActionPrompt("nuevo", { sessionId, workspaceId: workspace.workspaceId }),
        "El pedido de arriba es el brief: no hace falta volver a preguntarlo.",
      ].join("\n\n");
      saveSessionDraft(draftScope, workspace.workspaceId, sessionId, { text: prompt, mode: "prompt" });
      useComposerStateStore.getState().setDraft(sessionId, prompt);
      markComposerAutoSend(sessionId);
      setPending(addPendingVideoRequest({ sessionId, idea, at: Date.now() }));
      setNewVideoOpen(false);
      setNewVideoText("");
      navigate(`/workspace/${workspace.workspaceId}/session/${sessionId}`);
    } catch (error) {
      toast.error(`No se pudo crear el video: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setNewVideoBusy(false);
    }
  };

  /** Contesta la pregunta del agente desde el panel, sin abrir la conversación. */
  const answerQuestion = async (answers: string[][]) => {
    const request = pendingQuestion;
    const client = questions.client;
    if (!request || !client) return;
    const clean = answers.map((labels) => labels.map((label) => label.trim()).filter(Boolean));
    if (clean.length !== request.fields.length || clean.some((labels) => labels.length === 0)) {
      setQuestionError("Elegí una opción en cada pregunta.");
      return;
    }
    setQuestionBusy(request.id);
    setQuestionError(null);
    try {
      const directory = workspace.selectedWorkspaceRoot || undefined;
      if (isOpencodeV2Client(client)) {
        unwrap(await client.replySessionQuestion({ sessionID: request.sessionID, requestID: request.id, answers: clean }));
      } else {
        unwrap(await client.question.reply({ requestID: request.id, answers: clean, directory }));
      }
      // The rest of the app reads the same pending state: clearing it here
      // also stops the conversation from showing the question as unanswered.
      if (workspace.workspaceId) settleQuestionState(workspace.workspaceId, request.sessionID, request.id);
      setQuestionPicks([]);
      setQuestionText("");
      await questions.refetch();
      void chat.refetch();
    } catch (error) {
      setQuestionError(
        error instanceof Error ? error.message : "No se pudo enviar la respuesta.",
      );
    } finally {
      setQuestionBusy(null);
    }
  };

  const toggleQuestionPick = (index: number, label: string, multiple: boolean) => {
    setQuestionPicks((current) => {
      const next = current.map((labels) => [...labels]);
      const field = next[index] ?? [];
      if (multiple) {
        next[index] = field.includes(label)
          ? field.filter((value) => value !== label)
          : [...field, label];
      } else {
        next[index] = [label];
      }
      return next;
    });
  };

  const questionReady = pendingQuestion
    ? pendingQuestion.fields.every((_, index) => (questionPicks[index] ?? []).length > 0)
    : false;
  const questionNeedsSend = pendingQuestion
    ? pendingQuestion.fields.length > 1 || pendingQuestion.fields.some((field) => field.multiple)
    : false;

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b px-6 py-4">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold tracking-[-0.01em]">Video</h1>
          <p className="truncate text-xs text-muted-foreground">{workspace.selectedWorkspaceRoot}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button size="sm" onClick={() => setNewVideoOpen(true)}>
            <Plus className="size-3.5" /> Nuevo video
          </Button>
          <Button variant="outline" size="sm" onClick={() => setStudioOpen(true)}>
            <Settings2 className="size-3.5" /> Estudio
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="xl:hidden"
            aria-expanded={chatOpen}
            onClick={() => setChatOpen((open) => !open)}
          >
            <MessageSquare className="size-3.5" /> Chat
          </Button>
          <Button variant="ghost" size="sm" onClick={refetch}>
            <RefreshCw className="size-3.5" /> Recargar
          </Button>
          <Button variant="outline" size="sm" onClick={backToChat}>Volver al chat</Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_340px]">
        <aside className="min-h-0 overflow-y-auto border-r px-2 py-3">
          {pending.length > 0 ? (
            <div className="mb-3 space-y-1.5 border-b pb-3">
              <p className="px-2 pt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Pedidos sin proyecto todavía
              </p>
              {pending.map((entry) => (
                <div key={entry.sessionId} className="rounded-lg border border-dashed px-2 py-2">
                  <p className="line-clamp-2 text-[12px]">{entry.idea}</p>
                  <div className="mt-1.5 flex items-center gap-1">
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => navigate(`/workspace/${workspace.workspaceId}/session/${entry.sessionId}`)}
                    >
                      Abrir chat
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => setPending(removePendingVideoRequest(entry.sessionId))}
                    >
                      Descartar
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {allGroups.length === 0 ? (
            projects.isLoading ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">Cargando proyectos…</p>
            ) : projects.isError ? (
              <div className="space-y-2 px-3 py-2">
                <p className="text-sm text-muted-foreground">
                  No se pudieron leer los videos. Si el servidor tiene Video studio desactivado, la ruta responde 404.
                </p>
                <Button size="sm" variant="outline" onClick={() => void projects.refetch()}>
                  Reintentar
                </Button>
              </div>
            ) : (
              <div className="space-y-2 px-3 py-2">
                <p className="text-sm text-muted-foreground">Todavía no hay videos en ningún workspace.</p>
                <Button size="sm" onClick={() => setNewVideoOpen(true)}>Crear el primero</Button>
              </div>
            )
          ) : (
            <>
              <div className="space-y-2 border-b px-1.5 pb-3">
                <input
                  value={listQuery}
                  onChange={(event) => setListQuery(event.target.value)}
                  placeholder="Buscar video…"
                  aria-label="Buscar video"
                  className="w-full rounded-md border bg-transparent px-2 py-1.5 text-[12px] outline-none focus:ring-1"
                />
                {allGroups.length > 1 ? (
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() => setWorkspaceFilter("all")}
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px]",
                        workspaceFilter === "all" ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60",
                      )}
                    >
                      Todos ({recent.length})
                    </button>
                    {allGroups.map((group) => (
                      <button
                        key={group.workspaceId}
                        type="button"
                        onClick={() => setWorkspaceFilter(group.workspaceId)}
                        className={cn(
                          "max-w-full truncate rounded-full border px-2 py-0.5 text-[10px]",
                          workspaceFilter === group.workspaceId
                            ? "bg-muted text-foreground"
                            : "text-muted-foreground hover:bg-muted/60",
                        )}
                      >
                        {group.name || group.workspaceId} ({group.projects.length})
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <nav className="mt-2 space-y-0.5">
                {listEntries.map(({ group, project }) => {
                  const ready = GATES.filter((gate) => gateReady(project, gate)).length;
                  const isCurrent = group.workspaceId === workspace.workspaceId;
                  const root = isCurrent ? workspace.selectedWorkspaceRoot : group.root;
                  return (
                    <button
                      key={`${group.workspaceId}:${project.slug}`}
                      type="button"
                      onClick={() => {
                        if (!confirmDiscard()) return;
                        openProject(group, project.slug);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors",
                        isCurrent && project.slug === selected?.slug ? "bg-muted" : "hover:bg-muted/60",
                      )}
                    >
                      {project.hasStill && root ? (
                        <img
                          src={`${fileUrl(root, `video-projects/${project.slug}/qa/still.png`)}?v=${thumbVersion}`}
                          alt=""
                          className="h-10 w-6 shrink-0 rounded object-cover"
                          onError={(event) => {
                            event.currentTarget.style.visibility = "hidden";
                          }}
                        />
                      ) : (
                        <span className="h-10 w-6 shrink-0 rounded bg-muted-foreground/20" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{videoTitle(project)}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {isCurrent ? "" : `${group.name || group.workspaceId} · `}
                          {relativeTime(project.updatedAt)} · {ready}/{GATES.length} gates · {project.cue?.meta?.durationSeconds ?? 0}s
                        </span>
                      </span>
                      {project.hasFinal ? (
                        <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] text-muted-foreground">Final</span>
                      ) : null}
                    </button>
                  );
                })}
              </nav>
              {listEntries.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">Ningún video coincide con la búsqueda.</p>
              ) : null}
            </>
          )}
        </aside>

        <main className="min-h-0 overflow-y-auto px-6 py-5">
          {view === "recent" ? (
            <div className="mx-auto max-w-4xl space-y-4">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-[17px] font-semibold">Recientes</h2>
                <span className="text-xs text-muted-foreground">
                  {recent.length === 1 ? "1 video" : `${recent.length} videos`}
                </span>
              </div>
              {recent.length === 0 ? (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Todavía no hay videos en este workspace.</p>
                  <Button size="sm" onClick={() => setNewVideoOpen(true)}>Crear el primero</Button>
                </div>
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {recent.map(({ group, project }) => {
                    const ready = GATES.filter((gate) => gateReady(project, gate)).length;
                    const root = group.workspaceId === workspace.workspaceId ? workspace.selectedWorkspaceRoot : group.root;
                    return (
                      <li key={`${group.workspaceId}:${project.slug}`}>
                        <button
                          type="button"
                          onClick={() => {
                            if (!confirmDiscard()) return;
                            openProject(group, project.slug);
                          }}
                          className="flex w-full flex-col overflow-hidden rounded-xl border text-left transition-colors hover:bg-muted/50"
                        >
                          <span className="relative block h-32 w-full bg-muted">
                            {project.hasStill && root ? (
                              <img
                                src={`${fileUrl(root, `video-projects/${project.slug}/qa/still.png`)}?v=${thumbVersion}`}
                                alt=""
                                className="h-full w-full object-cover"
                                onError={(event) => {
                                  event.currentTarget.style.visibility = "hidden";
                                }}
                              />
                            ) : null}
                            {project.hasFinal ? (
                              <span className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-medium text-white">
                                Final
                              </span>
                            ) : null}
                          </span>
                          <span className="block space-y-0.5 p-3">
                            <span className="block truncate text-[13px] font-medium">
                              {videoTitle(project)}
                            </span>
                            <span className="block text-[11px] text-muted-foreground">
                              {allGroups.length > 1 ? `${group.name || group.workspaceId} · ` : ""}
                              {project.lastActivity ? `${project.lastActivity} · ` : ""}
                              {relativeTime(project.updatedAt)}
                            </span>
                            <span className="block text-[11px] text-muted-foreground">
                              {ready}/{GATES.length} gates · {project.cue?.meta?.durationSeconds ?? 0}s
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : !selected ? (
            <p className="text-sm text-muted-foreground">Elegí un proyecto.</p>
          ) : !draft ? (
            <p className="text-sm text-muted-foreground">Cargando opciones…</p>
          ) : (
            <div className="mx-auto max-w-3xl space-y-8">
              <div>
                <Button variant="ghost" size="sm" onClick={() => setView("recent")}>
                  <ArrowLeft className="size-3.5" /> Recientes
                </Button>
              </div>
              <section>
                <div className="flex items-baseline justify-between gap-4">
                  <h2 className="min-w-0">
                    <span className="block truncate text-[17px] font-semibold">{videoTitle(selected)}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{selected.slug}</span>
                  </h2>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {draft.cue.meta?.durationSeconds ?? 0}s · {effectiveAspect}
                  </span>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {GATES.filter((gate) => gateReady(selected, gate)).length}/{GATES.length} piezas listas ·{" "}
                  {selected.hasFinal ? "hay render final" : "todavía sin render final"}
                </p>
              </section>

              <section>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-[13px] font-semibold">Preview</h3>
                    <span className="text-[11px] text-muted-foreground">
                      {draft.cue.meta?.durationSeconds ?? 0}s · {effectiveAspect}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-muted-foreground">Formato</span>
                    {["9:16", "16:9", "1:1"].map((value) => (
                      <Button
                        key={value}
                        size="xs"
                        variant={effectiveAspect === value ? "default" : "outline"}
                        onClick={() => patchFormat({ aspect: value })}
                      >
                        {value}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="mt-2 overflow-hidden rounded-xl border bg-black/90 p-2">
                  {selected.hasFinal ? (
                    <div
                      className="mx-auto overflow-hidden rounded-lg"
                      style={{
                        aspectRatio: String(previewRatio),
                        width: `min(100%, calc(46vh * ${previewRatio}))`,
                      }}
                    >
                      <video
                        ref={videoRef}
                        controls
                        preload="metadata"
                        src={`${fileUrl(workspace.selectedWorkspaceRoot, `video-projects/${selected.slug}/renders/final.mp4`)}?v=${previewFinalVersion}`}
                        className="h-full w-full rounded-lg object-cover"
                        onTimeUpdate={(event) => setPreviewSecond(event.currentTarget.currentTime)}
                      />
                    </div>
                  ) : selected.hasStill ? (
                    <div
                      className="mx-auto overflow-hidden rounded-lg"
                      style={{
                        aspectRatio: String(previewRatio),
                        width: `min(100%, calc(46vh * ${previewRatio}))`,
                      }}
                    >
                      <img
                        src={`${fileUrl(workspace.selectedWorkspaceRoot, `video-projects/${selected.slug}/qa/still.png`)}?v=${previewStillVersion}`}
                        alt={`Still de ${videoTitle(selected)}`}
                        className="h-full w-full rounded-lg object-cover"
                        onError={(event) => {
                          event.currentTarget.style.visibility = "hidden";
                        }}
                        onLoad={(event) => {
                          event.currentTarget.style.visibility = "visible";
                        }}
                      />
                    </div>
                  ) : (
                    <p className="px-3 py-10 text-center text-[12px] text-muted-foreground">
                      Todavía no hay still ni render: pedile al agente el primer still.
                    </p>
                  )}
                </div>
                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  El formato se recorta acá para mostrar el encuadre; el render lo recompone.
                </p>
              </section>

              <section>
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-[13px] font-semibold">Escenas</h3>
                  <span className="text-[11px] text-muted-foreground">
                    {beats.length === 0 ? "sin beats" : `${beats.length} beats · tocá el tiempo para ir`}
                  </span>
                </div>
                {beats.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Este video todavía no tiene beats en el cue-sheet.
                  </p>
                ) : (
                  <div className="mt-2 flex gap-2 overflow-x-auto pb-2">
                    {beats.map((beat, index) => {
                      const at = Number.isFinite(beat.time) ? beat.time : 0;
                      const next = beats[index + 1];
                      const nextTime = next && Number.isFinite(next.time)
                        ? next.time
                        : draft.cue.meta?.durationSeconds ?? at;
                      const duration = beat.duration ?? Math.max(0, nextTime - at);
                      const text = beat.text ?? "";
                      const wps = beatWordsPerSecond(text, duration);
                      return (
                        <div
                          key={beat.id || `${at}-${index}`}
                          className={cn(
                            "w-44 shrink-0 rounded-lg border p-2 transition-colors",
                            currentBeat === index ? "border-ring bg-muted/40" : "bg-background",
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => seekPreview(at)}
                            className="flex w-full items-center justify-between text-[10px] text-muted-foreground"
                            title="Ir a este momento del video"
                          >
                            <span className="font-medium text-foreground">{clockTime(at)}</span>
                            <span>{duration > 0 ? `${duration.toFixed(1)}s` : ""}</span>
                          </button>
                          <textarea
                            value={text}
                            onChange={(event) => patchBeat(index, { text: event.target.value })}
                            rows={3}
                            placeholder="Texto de la escena"
                            aria-label={`Texto de la escena en ${clockTime(at)}`}
                            className="mt-1 w-full resize-none bg-transparent text-[11px] leading-snug outline-none"
                          />
                          {beat.voice?.line ? (
                            <p className="mt-1 line-clamp-2 text-[10px] text-muted-foreground">
                              Voz: {beat.voice.line}
                            </p>
                          ) : null}
                          {wps > 3.2 ? (
                            <p className="mt-1 text-[10px] text-amber-11">
                              No entra: {wps.toFixed(1)} palabras/s
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              <section>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[13px] font-semibold">Avisos del QA</h3>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={chatBusy}
                    onClick={() => {
                      setChatOpen(true);
                      void sendChangeRequest({
                        text: `Corré render_qa en video-projects/${selected.slug} y mostrame las recomendaciones.`,
                        mode: "raw",
                      });
                    }}
                  >
                    <Sparkles className="size-3.5" /> Correr QA
                  </Button>
                </div>
                {!selected.report ? (
                  <p className="mt-2 text-sm text-muted-foreground">Sin QA todavía.</p>
                ) : qaIssues.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">Sin avisos del último QA.</p>
                ) : (
                  <ul className="mt-2 divide-y rounded-xl border">
                    {qaIssues.map((check) => {
                      const at = secondsFromDetail(check.detail);
                      return (
                        <li key={check.name} className="flex items-start gap-3 px-4 py-3">
                          <Sparkles className="mt-0.5 size-4 shrink-0 text-amber-11" />
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-medium">{check.name}</p>
                            <p className="text-xs text-muted-foreground">{check.detail}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            {at !== null && selected.hasFinal ? (
                              <Button size="xs" variant="ghost" onClick={() => seekPreview(at)}>
                                Ver {clockTime(at)}
                              </Button>
                            ) : null}
                            <Button
                              size="xs"
                              variant="outline"
                              disabled={chatBusy}
                              onClick={() => {
                                setChatOpen(true);
                                void sendChangeRequest({
                                  text: `En video-projects/${selected.slug}, corregí "${check.name}": ${check.detail}. Revisá style.json y volvé a renderizar.`,
                                  mode: "raw",
                                });
                              }}
                            >
                              <Send className="size-3.5" /> Pedir
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <details className="rounded-xl border p-3">
                <summary className="cursor-pointer text-[13px] font-semibold">Ajustes de pistas</summary>
                <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3">
                  <OptionToggle label="Voz" checked={options.voice !== false} onChange={(checked) => patchOptions({ voice: checked })} />
                  <OptionToggle label="Subtítulos" checked={options.captions !== false} onChange={(checked) => patchOptions({ captions: checked })} />
                  <OptionToggle label="Lower third" checked={options.lowerThird !== false} onChange={(checked) => patchOptions({ lowerThird: checked })} />
                  <OptionToggle label="SFX" checked={options.sfx !== false} onChange={(checked) => patchOptions({ sfx: checked })} />
                </div>
                <p className="mt-2 text-[10px] text-muted-foreground">
                  Prenden o apagan pistas al renderizar. Se aplican al próximo render.
                </p>
              </details>

              <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/30 p-3">
                <Button size="sm" onClick={() => void saveAndRender()} disabled={chatBusy}>
                  <Play className="size-3.5" /> Renderizar
                  {renderMinutes > 0 ? ` (≈${renderMinutes} min)` : ""}
                </Button>
                <Button size="sm" variant="outline" onClick={() => void saveEdits()} disabled={!dirty}>
                  Guardar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void copyPrompt(renderPrompt(selected.slug))}
                >
                  <Copy className="size-3.5" /> Copiar pedido
                </Button>
                {dirty ? (
                  <span className="rounded-full bg-amber-3 px-2 py-0.5 text-[11px] font-medium text-amber-11">
                    Sin guardar
                  </span>
                ) : null}
                <span className="ml-auto text-[10px] text-muted-foreground">
                  Cambiar texto o ajustes pide un render nuevo.
                </span>
              </div>
            </div>
          )}
        </main>

        <aside
          className={cn(
            "min-h-0 flex-col border-l bg-background",
            chatOpen
              ? "absolute inset-y-0 right-0 z-30 flex w-[min(92vw,380px)] shadow-2xl"
              : "hidden xl:flex",
            "xl:static xl:z-auto xl:w-auto xl:shadow-none",
          )}
          data-video-chat
        >
          <div className="flex shrink-0 items-start justify-between gap-2 border-b px-4 py-3">
            <div className="min-w-0">
              <h3 className="text-[13px] font-semibold">Chat del video</h3>
              <p className="truncate text-xs text-muted-foreground">
                {origin.data?.title?.trim() || selected?.slug || "Sin video seleccionado"}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {activeChatSessionId ? (
                <Button
                  size="xs"
                  variant="ghost"
                  title="Abrir esta conversación en el chat"
                  aria-label="Abrir esta conversación en el chat"
                  onClick={() => navigate(`/workspace/${workspace.workspaceId}/session/${activeChatSessionId}`)}
                >
                  <ExternalLink className="size-3.5" />
                </Button>
              ) : null}
              {activeChatSessionId ? (
                <Button
                  size="xs"
                  variant="ghost"
                  title="Borrar la conversación de este video"
                  aria-label="Borrar la conversación de este video"
                  onClick={() => void deleteChatSession()}
                  disabled={chatBusy}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              ) : null}
              <Button
                size="xs"
                variant="ghost"
                className="xl:hidden"
                aria-label="Cerrar el chat del video"
                onClick={() => setChatOpen(false)}
              >
                <X className="size-3.5" />
              </Button>
            </div>
          </div>

          <div className="shrink-0 border-b px-3 py-2">
            <button
              type="button"
              onClick={() => modelPicker.setOpen(true)}
              disabled={!selected}
              title="Modelo de la conversación de este video"
              className="flex w-full items-center justify-between gap-2 rounded-lg border px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-muted/60 disabled:opacity-50"
            >
              <span className="min-w-0 truncate">
                <span className="text-muted-foreground">Modelo: </span>
                <span className="font-medium">{chatModel.modelID}</span>
                <span className="text-muted-foreground"> · {chatModel.providerID}</span>
                {chatModelIsExplicit ? null : (
                  <span className="text-muted-foreground"> (de la app)</span>
                )}
              </span>
              <ChevronDown className="size-3.5 shrink-0 opacity-60" />
            </button>
          </div>

          <div ref={chatScrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
            {chat.isLoading ? (
              <p className="text-xs text-muted-foreground">Cargando conversación…</p>
            ) : chat.isError ? (
              <p className="text-xs text-muted-foreground">No se pudo leer la conversación de este video.</p>
            ) : chatRows.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {activeChatSessionId
                  ? "Todavía no hay mensajes en esta conversación."
                  : "La conversación propia del video se crea con el primer pedido."}
              </p>
            ) : (
              chatRows.map((row) => (
                <div
                  key={row.id}
                  className={cn(
                    "rounded-xl px-3 py-2",
                    row.mine ? "ml-6 border bg-muted/60" : row.error ? "mr-4 border border-amber-7 bg-amber-2" : "border",
                  )}
                >
                  <p className="text-[11px] font-medium text-muted-foreground">
                    {row.mine ? "Vos" : row.error ? "Motor" : "Agente"}
                  </p>
                  {row.mine ? (
                    <p className="mt-0.5 whitespace-pre-wrap text-[12px] leading-snug">{row.text}</p>
                  ) : (
                    <MarkdownBlock text={row.text} className="mt-0.5 text-[12px] leading-snug" />
                  )}
                  {!row.mine && row.tools?.length ? (
                    <ul className="mt-1.5 space-y-0.5">
                      {row.tools.slice(-4).map((tool) => (
                        <li key={tool.id} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <Wrench className="size-3 shrink-0" aria-hidden="true" />
                          <span className="shrink-0 font-medium">{tool.name}</span>
                          {tool.target ? <span className="truncate">{tool.target}</span> : null}
                          {tool.status && tool.status !== "completed" ? (
                            <span className="shrink-0">· {tool.status}</span>
                          ) : null}
                          {tool.ms ? <span className="shrink-0">· {(tool.ms / 1000).toFixed(1)}s</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {!row.mine && row.question?.text && !pendingQuestion ? (
                    <p className="mt-1.5 border-l-2 border-dashed pl-2 text-[11px] leading-snug text-muted-foreground">
                      Preguntó: {row.question.text}
                    </p>
                  ) : null}
                </div>
              ))
            )}
            {chatPending && !pendingQuestion ? (
              <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
                {chatBusy
                  ? "Enviando…"
                  : `${runningTool ? `${runningTool.name}…` : "El agente está trabajando…"} ${chatElapsed} s`}
              </p>
            ) : null}
          </div>

          {pendingQuestion ? (
            <div className="shrink-0 space-y-2 border-t bg-amber-2/50 p-3">
              <p className="flex items-center gap-1.5 text-[11px] font-medium text-amber-11">
                <MessageSquare className="size-3.5" aria-hidden="true" />
                El agente pregunta
              </p>
              {pendingQuestion.fields.map((field, index) => (
                <div key={`${pendingQuestion.id}:${index}`} className="space-y-1.5">
                  {field.header ? (
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{field.header}</p>
                  ) : null}
                  <p className="whitespace-pre-wrap text-[12px] leading-snug">{field.question}</p>
                  {field.options.length ? (
                    <ul className="space-y-1">
                      {field.options.map((option) => {
                        const picked = (questionPicks[index] ?? []).includes(option.label);
                        const autoSend = pendingQuestion.fields.length === 1 && !field.multiple;
                        return (
                          <li key={option.label}>
                            <Button
                              size="xs"
                              variant={picked ? "secondary" : "outline"}
                              className="h-auto w-full justify-start whitespace-normal py-1 text-left"
                              disabled={questionBusy !== null}
                              onClick={() => {
                                if (autoSend) {
                                  void answerQuestion([[option.label]]);
                                  return;
                                }
                                toggleQuestionPick(index, option.label, field.multiple);
                              }}
                            >
                              <span className="flex flex-col items-start gap-0.5">
                                <span>{option.label}</span>
                                {option.description ? (
                                  <span className="text-[10px] font-normal text-muted-foreground">{option.description}</span>
                                ) : null}
                              </span>
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </div>
              ))}
              {questionNeedsSend ? (
                <Button
                  size="sm"
                  className="w-full"
                  disabled={!questionReady || questionBusy !== null}
                  onClick={() => void answerQuestion(pendingQuestion.fields.map((_, index) => questionPicks[index] ?? []))}
                >
                  {questionBusy ? "Enviando…" : "Responder"}
                </Button>
              ) : null}
              {pendingQuestion.fields.length === 1 ? (
                <form
                  className="flex items-center gap-1.5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const text = questionText.trim();
                    if (!text || questionBusy !== null) return;
                    void answerQuestion([[text]]);
                  }}
                >
                  <input
                    value={questionText}
                    onChange={(event) => setQuestionText(event.target.value)}
                    placeholder="Otra respuesta…"
                    className="min-w-0 flex-1 rounded-md border bg-transparent px-2 py-1 text-[12px] outline-none focus:ring-1"
                  />
                  <Button type="submit" size="xs" variant="outline" disabled={!questionText.trim() || questionBusy !== null}>
                    Enviar
                  </Button>
                </form>
              ) : null}
              {questionError ? <p className="text-[10px] text-red-11">{questionError}</p> : null}
            </div>
          ) : null}

          <div className="shrink-0 space-y-2 border-t p-3">
            <textarea
              ref={changeRequestRef}
              value={changeRequest}
              onChange={(event) => {
                const value = event.target.value;
                setChangeRequest(value);
                // An empty field goes back to "a request about this project".
                if (!value.trim()) setChangeRequestMode("project");
              }}
              rows={3}
              placeholder="Pedile un cambio a este video…"
              className="w-full resize-y rounded-lg border bg-transparent px-3 py-2 text-[13px] outline-none focus:ring-1"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                size="sm"
                onClick={() => void sendChangeRequest()}
                disabled={!changeRequest.trim() || chatBusy || !endpoint}
              >
                <Send className="size-3.5" /> {chatBusy ? "Enviando…" : "Enviar"}
              </Button>
              <span className="text-[11px] text-muted-foreground">
                {activeChatSessionId ? "Conversación propia del video" : "Se crea al enviar el primer pedido"}
              </span>
            </div>
            {chatError ? <p className="text-[11px] text-amber-11">{chatError}</p> : null}
            {chatNote ? <p className="text-[11px] text-muted-foreground">{chatNote}</p> : null}
          </div>
        </aside>
      </div>

      {modelPicker.open ? (
        <ModelPickerModal
          open
          options={modelPicker.options}
          knownOptions={modelPicker.knownOptions}
          query={modelPicker.query}
          setQuery={modelPicker.setQuery}
          target="session"
          current={{ providerID: chatModel.providerID, modelID: chatModel.modelID }}
          currentBehaviorValue={chatModel.variant ?? null}
          onSelect={(next: ModelRef) => { void selectChatModel(next); }}
          onBehaviorChange={() => undefined}
          catalogState={modelPicker.catalogState}
          onOpenSettings={() => {
            modelPicker.setOpen(false);
            navigate(workspaceSettingsRoute(workspace.workspaceId, "ai"));
          }}
          onClose={() => modelPicker.setOpen(false)}
        />
      ) : null}

      <VideoStudioSettingsDialog
        open={studioOpen}
        onOpenChange={setStudioOpen}
        workspace={{
          workspaceId: workspace.workspaceId,
          selectedWorkspaceRoot: workspace.selectedWorkspaceRoot,
          openworkServerClient: workspace.openworkServerClient,
        }}
        projectSlug={selected?.slug ?? null}
        projectTitle={origin.data?.title?.trim() || selected?.slug || null}
        onAsk={askAgent}
      />

      <Dialog
        open={newVideoOpen}
        onOpenChange={(open) => {
          if (!newVideoBusy) setNewVideoOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nuevo video</DialogTitle>
            <DialogDescription>
              Contá qué video querés. Se abre el chat y el pedido sale solo; el agente crea el proyecto en
              video-projects/ y después aparece en este panel.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={newVideoText}
            onChange={(event) => setNewVideoText(event.target.value)}
            rows={4}
            autoFocus
            placeholder="Un video de 30 segundos que explique qué es el comercio exterior, con mi voz y subtítulos."
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNewVideoOpen(false)} disabled={newVideoBusy}>
              Cancelar
            </Button>
            <Button onClick={() => void startNewVideo()} disabled={!newVideoText.trim() || newVideoBusy}>
              {newVideoBusy ? "Creando…" : "Crear video"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

