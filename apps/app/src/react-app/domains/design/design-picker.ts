/**
 * Comentar / Editar on a design page (feature `designStudio`).
 *
 * `useDesignPicker` connects one or more `DesignFrame` iframes to the picker (design-picker-runtime)
 * through a transport (design-picker-transport), and turns what the person does into:
 * - Comentar: point at an element, write what to change, and send it to the agent chat with
 *   `onAskAgent(text, context)`; several comments can be queued and sent as one message.
 * - Editar: double-click a text, type, press Enter (or leave it) and the page file is saved with
 *   `writeDesignFile`; the previous file is kept so the edit can be undone.
 *
 * Editors mount it as:
 *
 *   const picker = useDesignPicker({ workspaceId, design, client, writable, onAskAgent, onChanged });
 *   <DesignCommentBar picker={picker} />
 *   <DesignFrame … interactive onFrameReady={picker.bindFrame(page)} />
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { formatPointedComments, type DesignPickerDesign, type DesignPickerPage, type DesignPointedComment } from "./design-picker-context";
import { applyTextEdit } from "./design-picker-edit";
import type { DesignPickerEvent, DesignPickerMode, DesignPickerRect, DesignPickerTarget } from "./design-picker-runtime";
import { attachDesignPicker, type DesignPickerTransport, type DesignPickerTransportKind } from "./design-picker-transport";

export type { DesignPickerMode, DesignPickerTarget } from "./design-picker-runtime";
export type { DesignPickerPage, DesignPickerDesign } from "./design-picker-context";

/** The two client methods the picker uses (`OpenworkServerClient` satisfies it). */
export interface DesignPickerClient {
  readDesignFile(workspaceId: string, designId: string, path: string): Promise<Blob>;
  writeDesignFile(workspaceId: string, designId: string, path: string, body: Blob | string): Promise<unknown>;
}

export interface UseDesignPickerOptions {
  workspaceId: string;
  design: DesignPickerDesign;
  client: DesignPickerClient;
  writable: boolean;
  onAskAgent: (text: string, context?: string) => void | Promise<void>;
  /** Called after a save or an undo so the editor reloads the frame (DesignFrame `reloadKey`). */
  onChanged?: () => void;
  /** Force a transport; by default it is read from the iframe's `sandbox`. */
  transport?: DesignPickerTransportKind;
}

/** Positions the comment box next to the element inside the frame (Base UI virtual anchor). */
export interface DesignPickerAnchor {
  getBoundingClientRect(): DOMRect;
  contextElement: Element;
}

export interface DesignCommentDraft {
  page: DesignPickerPage;
  target: DesignPickerTarget;
  anchor: DesignPickerAnchor;
}

export interface DesignPendingComment extends DesignPointedComment {
  id: string;
}

export type DesignPickerNotice =
  | "saving"
  | "saved"
  | "undone"
  | "error_save"
  | "error_changed"
  | "error_not_text"
  | "error_undo_changed"
  | "error_send";

export interface DesignPickerController {
  mode: DesignPickerMode;
  setMode(mode: DesignPickerMode): void;
  writable: boolean;
  /** Stable per page id: pass the result to `DesignFrame`'s `onFrameReady`. */
  bindFrame(page: DesignPickerPage): (iframe: HTMLIFrameElement) => void;
  draft: DesignCommentDraft | null;
  cancelDraft(): void;
  /** Adds the draft to the pending list. */
  queueDraft(comment: string): void;
  /** Sends the pending comments plus this one as one message. */
  sendDraft(comment: string): Promise<void>;
  pending: DesignPendingComment[];
  removePending(id: string): void;
  sendPending(): Promise<void>;
  sending: boolean;
  notice: DesignPickerNotice | null;
  canUndo: boolean;
  undo(): Promise<void>;
}

const UNDO_LIMIT = 20;

interface UndoEntry {
  page: DesignPickerPage;
  previous: string;
  next: string;
}

export function frameAnchor(iframe: HTMLIFrameElement, client: DesignPickerRect): DesignPickerAnchor {
  return {
    contextElement: iframe,
    getBoundingClientRect() {
      const frame = iframe.getBoundingClientRect();
      // The editor may scale the frame (zoom); map frame CSS px to window px.
      const scaleX = iframe.offsetWidth > 0 ? frame.width / iframe.offsetWidth : 1;
      const scaleY = iframe.offsetHeight > 0 ? frame.height / iframe.offsetHeight : 1;
      return new DOMRect(
        frame.left + (iframe.clientLeft + client.x) * scaleX,
        frame.top + (iframe.clientTop + client.y) * scaleY,
        client.width * scaleX,
        client.height * scaleY,
      );
    },
  };
}

let nextCommentId = 0;

export function useDesignPicker(options: UseDesignPickerOptions): DesignPickerController {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [mode, setModeState] = useState<DesignPickerMode>("view");
  const modeRef = useRef<DesignPickerMode>("view");
  const [draft, setDraft] = useState<DesignCommentDraft | null>(null);
  const [pending, setPending] = useState<DesignPendingComment[]>([]);
  const pendingRef = useRef<DesignPendingComment[]>([]);
  pendingRef.current = pending;
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<DesignPickerNotice | null>(null);
  const undoStack = useRef<UndoEntry[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const frames = useRef(new Map<string, { iframe: HTMLIFrameElement; transport: DesignPickerTransport }>());
  const pages = useRef(new Map<string, DesignPickerPage>());
  const binders = useRef(new Map<string, (iframe: HTMLIFrameElement) => void>());

  const forEachTransport = (run: (transport: DesignPickerTransport) => void) => {
    for (const frame of frames.current.values()) run(frame.transport);
  };

  const setMode = useCallback((next: DesignPickerMode) => {
    const allowed = next === "edit" && !optionsRef.current.writable ? "view" : next;
    modeRef.current = allowed;
    setModeState(allowed);
    setDraft(null);
    for (const frame of frames.current.values()) frame.transport.setMode(allowed);
  }, []);

  const cancelDraft = useCallback(() => {
    setDraft(null);
    for (const frame of frames.current.values()) frame.transport.clearSelection();
  }, []);

  const enqueue = (work: () => Promise<void>) => {
    const run = saveChain.current.then(work, work);
    saveChain.current = run.catch(() => undefined);
    return run;
  };

  const readText = async (page: DesignPickerPage) => {
    const { client, workspaceId, design } = optionsRef.current;
    const blob = await client.readDesignFile(workspaceId, design.id, page.file);
    return blob.text();
  };

  const saveEdit = (page: DesignPickerPage, event: Extract<DesignPickerEvent, { type: "edit" }>) => enqueue(async () => {
    const { client, workspaceId, design, writable } = optionsRef.current;
    if (!writable) return;
    setNotice("saving");
    try {
      const source = await readText(page);
      const result = applyTextEdit(source, { selector: event.target.selector, tag: event.target.tag, before: event.before, text: event.text });
      if (!result.ok) {
        setNotice(result.reason === "not_text" ? "error_not_text" : result.reason === "too_long" ? "error_save" : "error_changed");
        optionsRef.current.onChanged?.();
        return;
      }
      if (result.html === source) {
        setNotice(null);
        return;
      }
      await client.writeDesignFile(workspaceId, design.id, page.file, result.html);
      undoStack.current = [...undoStack.current, { page, previous: source, next: result.html }].slice(-UNDO_LIMIT);
      setUndoCount(undoStack.current.length);
      setNotice("saved");
    } catch {
      setNotice("error_save");
    }
    optionsRef.current.onChanged?.();
  });

  const undo = useCallback(() => enqueue(async () => {
    const entry = undoStack.current.at(-1);
    const { client, workspaceId, design, writable } = optionsRef.current;
    if (!entry || !writable) return;
    undoStack.current = undoStack.current.slice(0, -1);
    setUndoCount(undoStack.current.length);
    try {
      const current = await readText(entry.page);
      // Something else (the agent, another window) changed the file since: do not overwrite it.
      if (current !== entry.next) {
        undoStack.current = [];
        setUndoCount(0);
        setNotice("error_undo_changed");
        return;
      }
      await client.writeDesignFile(workspaceId, design.id, entry.page.file, entry.previous);
      setNotice("undone");
    } catch {
      undoStack.current = [...undoStack.current, entry];
      setUndoCount(undoStack.current.length);
      setNotice("error_save");
    }
    optionsRef.current.onChanged?.();
  }), []);

  const send = async (items: DesignPendingComment[]) => {
    const usable = items.filter(item => item.comment.trim().length > 0);
    if (usable.length === 0) return;
    const { design, onAskAgent } = optionsRef.current;
    const message = formatPointedComments({ id: design.id, title: design.title, kind: design.kind }, usable);
    setSending(true);
    try {
      await onAskAgent(message.text, message.context);
      const sent = new Set(usable.map(item => item.id));
      setPending(current => current.filter(item => !sent.has(item.id)));
      setDraft(null);
      setNotice(null);
      forEachTransport(transport => transport.clearSelection());
    } catch {
      setNotice("error_send");
    } finally {
      setSending(false);
    }
  };

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const toPending = (current: DesignCommentDraft, comment: string): DesignPendingComment => {
    nextCommentId += 1;
    return { id: `comment-${nextCommentId}`, comment: comment.trim(), page: current.page, target: current.target };
  };

  const queueDraft = useCallback((comment: string) => {
    const current = draftRef.current;
    if (!current || !comment.trim()) return;
    const item = toPending(current, comment);
    setPending(list => [...list, item]);
    setDraft(null);
    forEachTransport(transport => transport.clearSelection());
  }, []);

  const sendDraft = useCallback(async (comment: string) => {
    const current = draftRef.current;
    const items = [...pendingRef.current];
    if (current && comment.trim()) items.push(toPending(current, comment));
    await send(items);
  }, []);

  const sendPending = useCallback(() => send(pendingRef.current), []);

  const removePending = useCallback((id: string) => {
    setPending(list => list.filter(item => item.id !== id));
  }, []);

  const handleEvent = (pageId: string, iframe: HTMLIFrameElement, event: DesignPickerEvent) => {
    const page = pages.current.get(pageId);
    if (!page) return;
    switch (event.type) {
      case "select":
        if (modeRef.current !== "comment") return;
        setDraft({ page, target: event.target, anchor: frameAnchor(iframe, event.target.client) });
        return;
      case "edit":
        if (modeRef.current === "edit") void saveEdit(page, event);
        return;
      case "edit-unavailable":
        setNotice("error_not_text");
        return;
      case "escape":
        if (draftRef.current) cancelDraft();
        else setMode("view");
        return;
      case "undo":
        void undo();
        return;
      default:
        return;
    }
  };
  const handleEventRef = useRef(handleEvent);
  handleEventRef.current = handleEvent;

  const bindFrame = useCallback((page: DesignPickerPage) => {
    pages.current.set(page.id, page);
    const existing = binders.current.get(page.id);
    if (existing) return existing;
    const bind = (iframe: HTMLIFrameElement) => {
      const previous = frames.current.get(page.id);
      if (previous?.iframe === iframe) return;
      previous?.transport.dispose();
      const transport = attachDesignPicker(iframe, event => handleEventRef.current(page.id, iframe, event), optionsRef.current.transport);
      transport.setMode(modeRef.current);
      frames.current.set(page.id, { iframe, transport });
    };
    binders.current.set(page.id, bind);
    return bind;
  }, []);

  // Losing write access leaves Editar.
  useEffect(() => {
    if (!options.writable && modeRef.current === "edit") setMode("view");
  }, [options.writable, setMode]);

  useEffect(() => {
    const current = frames.current;
    return () => {
      for (const frame of current.values()) frame.transport.dispose();
      current.clear();
    };
  }, []);

  return useMemo(() => ({
    mode,
    setMode,
    writable: options.writable,
    bindFrame,
    draft,
    cancelDraft,
    queueDraft,
    sendDraft,
    pending,
    removePending,
    sendPending,
    sending,
    notice,
    canUndo: undoCount > 0 && options.writable,
    undo,
  }), [mode, setMode, options.writable, bindFrame, draft, cancelDraft, queueDraft, sendDraft, pending, removePending, sendPending, sending, notice, undoCount, undo]);
}
