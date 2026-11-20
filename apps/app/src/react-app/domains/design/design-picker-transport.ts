import { z } from "zod";

import {
  DESIGN_PICKER_CHANNEL,
  designPickerRuntime,
  type DesignPickerEvent,
  type DesignPickerHandle,
  type DesignPickerMode,
} from "./design-picker-runtime";

/**
 * How the parent reaches the page inside a `DesignFrame` iframe. Two transports, one interface:
 *
 * - "same-origin" (recommended): the iframe is `sandbox="allow-same-origin"` WITHOUT
 *   `allow-scripts`. The page runs no script at all; the parent attaches the picker's listeners to
 *   `iframe.contentDocument`. Nothing has to be injected into the page.
 * - "post-message": the iframe is `sandbox="allow-scripts"` WITHOUT `allow-same-origin` (opaque
 *   origin). The frame must run `DESIGN_PICKER_SCRIPT` (see `withDesignPickerScript`) and its CSP
 *   must allow it (`script-src 'sha256-…'` from `designPickerScriptHash()`); the parent and the
 *   frame then exchange `{ channel: "openwork-design-picker", … }` messages.
 *
 * Never combine `allow-scripts` with `allow-same-origin`: the page could remove its own sandbox.
 */
export type DesignPickerTransportKind = "same-origin" | "post-message";

export interface DesignPickerTransport {
  kind: DesignPickerTransportKind;
  setMode(mode: DesignPickerMode): void;
  clearSelection(): void;
  dispose(): void;
}

const rectSchema = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });
const targetSchema = z.object({
  selector: z.string().min(1).max(4_000),
  tag: z.string().min(1).max(64),
  text: z.string().max(2_000),
  box: rectSchema,
  client: rectSchema,
});
export const designPickerEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready") }),
  z.object({ type: z.literal("select"), target: targetSchema }),
  z.object({ type: z.literal("edit"), target: targetSchema, before: z.string().max(100_000), text: z.string().max(100_000) }),
  z.object({ type: z.literal("edit-cancel") }),
  z.object({ type: z.literal("edit-unavailable"), target: targetSchema }),
  z.object({ type: z.literal("escape") }),
  z.object({ type: z.literal("undo") }),
]);
const frameMessageSchema = z.object({ channel: z.literal(DESIGN_PICKER_CHANNEL) }).passthrough();

/** The script a frame without same-origin runs so the parent can pick inside it. */
export const DESIGN_PICKER_SCRIPT = `(${designPickerRuntime.toString()})().bridge(window);`;

/** Inserts the picker script before `</body>` (or at the end) of a page document for `srcdoc`. */
export function withDesignPickerScript(html: string, nonce?: string): string {
  const tag = `<script${nonce ? ` nonce="${nonce.replace(/[^A-Za-z0-9+/=_-]/g, "")}"` : ""}>${DESIGN_PICKER_SCRIPT.replace(/<\/script/gi, "<\\/script")}</script>`;
  const at = html.toLowerCase().lastIndexOf("</body>");
  return at < 0 ? html + tag : html.slice(0, at) + tag + html.slice(at);
}

/** CSP source for the injected script, e.g. `script-src 'sha256-…'`. */
export async function designPickerScriptHash(): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(DESIGN_PICKER_SCRIPT.replace(/<\/script/gi, "<\\/script")));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return `'sha256-${btoa(binary)}'`;
}

/** Which transport a frame's sandbox allows. */
export function detectDesignPickerTransport(iframe: HTMLIFrameElement): DesignPickerTransportKind {
  const sandbox = iframe.getAttribute("sandbox");
  if (sandbox === null) return "same-origin";
  return sandbox.split(/\s+/).includes("allow-same-origin") ? "same-origin" : "post-message";
}

function attachSameOrigin(iframe: HTMLIFrameElement, onEvent: (event: DesignPickerEvent) => void): DesignPickerTransport {
  const runtime = designPickerRuntime();
  let mode: DesignPickerMode = "view";
  let handle: DesignPickerHandle | null = null;
  let attachedTo: Document | null = null;
  const install = () => {
    const doc = iframe.contentDocument;
    if (!doc || doc === attachedTo) return;
    handle?.dispose();
    attachedTo = doc;
    handle = runtime.install(doc, onEvent);
    handle.setMode(mode);
  };
  // A frame that reloads (files changed) gets a new document.
  iframe.addEventListener("load", install);
  install();
  return {
    kind: "same-origin",
    setMode(next) {
      mode = next;
      install();
      handle?.setMode(next);
    },
    clearSelection() {
      handle?.clearSelection();
    },
    dispose() {
      iframe.removeEventListener("load", install);
      handle?.dispose();
      handle = null;
      attachedTo = null;
    },
  };
}

function attachPostMessage(iframe: HTMLIFrameElement, onEvent: (event: DesignPickerEvent) => void): DesignPickerTransport {
  let mode: DesignPickerMode = "view";
  const send = (message: { type: "mode"; mode: DesignPickerMode } | { type: "clear" }) => {
    // The frame has an opaque origin, so "*" is the only target that reaches it. The message
    // carries no data: only the mode.
    iframe.contentWindow?.postMessage({ channel: DESIGN_PICKER_CHANNEL, ...message }, "*");
  };
  const onMessage = (message: MessageEvent) => {
    if (!iframe.contentWindow || message.source !== iframe.contentWindow) return;
    if (!frameMessageSchema.safeParse(message.data).success) return;
    const parsed = designPickerEventSchema.safeParse(message.data);
    if (!parsed.success) return;
    // The frame (re)loaded: tell it the current mode.
    if (parsed.data.type === "ready") send({ type: "mode", mode });
    onEvent(parsed.data);
  };
  window.addEventListener("message", onMessage);
  return {
    kind: "post-message",
    setMode(next) {
      mode = next;
      send({ type: "mode", mode: next });
    },
    clearSelection() {
      send({ type: "clear" });
    },
    dispose() {
      window.removeEventListener("message", onMessage);
    },
  };
}

export function attachDesignPicker(
  iframe: HTMLIFrameElement,
  onEvent: (event: DesignPickerEvent) => void,
  kind: DesignPickerTransportKind = detectDesignPickerTransport(iframe),
): DesignPickerTransport {
  const checked = (event: DesignPickerEvent) => {
    const parsed = designPickerEventSchema.safeParse(event);
    if (parsed.success) onEvent(parsed.data);
  };
  return kind === "same-origin" ? attachSameOrigin(iframe, checked) : attachPostMessage(iframe, checked);
}
